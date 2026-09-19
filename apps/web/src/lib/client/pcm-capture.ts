// Mic audio as 16 kHz mono signed 16-bit little-endian PCM, the format the
// Deepgram socket is opened with. An AudioWorklet copies each 128-sample block
// out of the audio thread; downsampling happens here on the main thread.

export const PCM_SAMPLE_RATE = 16_000;
// About 100 ms per message: small enough to keep latency low, big enough not
// to flood the socket.
const CHUNK_SAMPLES = PCM_SAMPLE_RATE / 10;

const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
`;

const loadedContexts = new WeakSet<AudioContext>();

async function loadWorklet(ctx: AudioContext) {
  if (loadedContexts.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  loadedContexts.add(ctx);
}

export type PcmCapture = { stop: () => void };

export async function capturePcm(
  ctx: AudioContext,
  stream: MediaStream,
  onChunk: (pcm: ArrayBuffer) => void,
): Promise<PcmCapture> {
  await loadWorklet(ctx);
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "pcm-tap");
  // Safari only runs a node that feeds the destination, so route it through silence.
  const silence = ctx.createGain();
  silence.gain.value = 0;
  source.connect(tap).connect(silence).connect(ctx.destination);

  const ratio = ctx.sampleRate / PCM_SAMPLE_RATE;
  let carry = new Float32Array(0);
  let out = new Int16Array(CHUNK_SAMPLES);
  let filled = 0;

  tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const input = new Float32Array(carry.length + event.data.length);
    input.set(carry);
    input.set(event.data, carry.length);
    const count = Math.floor(input.length / ratio);
    for (let i = 0; i < count; i++) {
      // Average each window of input samples: a crude low-pass that keeps
      // speech intelligible without a proper resampler.
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j] ?? 0;
      const sample = Math.max(-1, Math.min(1, sum / (to - from)));
      out[filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (filled === CHUNK_SAMPLES) {
        onChunk(out.buffer);
        out = new Int16Array(CHUNK_SAMPLES);
        filled = 0;
      }
    }
    carry = input.slice(Math.floor(count * ratio));
  };

  return {
    stop() {
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      silence.disconnect();
      if (filled > 0) onChunk(out.slice(0, filled).buffer);
    },
  };
}
