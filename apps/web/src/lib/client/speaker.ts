// Spoken answers. Server TTS streams PCM (README "Text to speech") and
// playPcmStream schedules it chunk by chunk; when no provider is configured
// the server sends text and speak() uses the browser's speech synthesis. The
// rate comes from the wearer's settings, where slower than default is the point.

export type SpeechOutcome = "played" | "cancelled" | "failed";

export type PcmStreamFormat = { sampleRate: number; channels: number };

/** Reads the audio contract headers the ask route sets; null for a JSON answer. */
export function pcmFormatFromHeaders(headers: Headers): PcmStreamFormat | null {
  if (!headers.get("content-type")?.startsWith("audio/pcm")) return null;
  const sampleRate = Number(headers.get("x-audio-sample-rate") ?? 24_000);
  const channels = Number(headers.get("x-audio-channels") ?? 1);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channels < 1) return null;
  return { sampleRate, channels };
}

/** Signed 16-bit little-endian samples to floats; interleaved channels split out. */
function decodePcm16(bytes: Uint8Array, channels: number): Float32Array<ArrayBuffer>[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor(bytes.byteLength / 2 / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(new ArrayBuffer(frames * 4)));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      out[channel][frame] = view.getInt16((frame * channels + channel) * 2, true) / 32768;
    }
  }
  return out;
}

// Enough audio to ride out a network hiccup, without a noticeable wait.
const PREROLL_SECONDS = 0.08;
const LEAD_SECONDS = 0.03;

/**
 * Plays streamed PCM as it arrives, scheduling each chunk right after the one
 * before so playback is gapless. Ends "failed" when the stream breaks before
 * any sound; "cancelled" when the caller stops it; "played" once the last
 * sample has sounded.
 */
export function playPcmStream(body: ReadableStream<Uint8Array>, context: AudioContext, format: PcmStreamFormat): Speech {
  const reader = body.getReader();
  const sources = new Set<AudioBufferSourceNode>();
  let cancelled = false;
  let nextTime = 0;
  let pending = new Uint8Array(0);
  let resolveStarted: (at: number | null) => void = () => {};
  const started = new Promise<number | null>((resolve) => (resolveStarted = resolve));
  const frameBytes = 2 * format.channels;

  function schedule(bytes: Uint8Array) {
    const usable = bytes.byteLength - (bytes.byteLength % frameBytes);
    if (usable === 0) return;
    const channels = decodePcm16(bytes.subarray(0, usable), format.channels);
    const buffer = context.createBuffer(format.channels, channels[0].length, format.sampleRate);
    channels.forEach((samples, index) => buffer.copyToChannel(samples, index));
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    if (nextTime === 0) {
      nextTime = context.currentTime + LEAD_SECONDS;
      resolveStarted(performance.now() + LEAD_SECONDS * 1000);
    } else if (nextTime < context.currentTime) {
      // An underrun: the network fell behind; pick up from now rather than rushing.
      nextTime = context.currentTime + LEAD_SECONDS;
    }
    source.start(nextTime);
    nextTime += buffer.duration;
    sources.add(source);
    source.onended = () => sources.delete(source);
  }

  const done = (async (): Promise<SpeechOutcome> => {
    let anyAudio = false;
    try {
      const prerollBytes = Math.ceil(PREROLL_SECONDS * format.sampleRate) * frameBytes;
      while (true) {
        const { done, value } = await reader.read();
        if (cancelled) return "cancelled";
        if (done) break;
        if (value.byteLength === 0) continue;
        anyAudio = true;
        const merged = new Uint8Array(pending.byteLength + value.byteLength);
        merged.set(pending);
        merged.set(value, pending.byteLength);
        // Buffer a little before the first sound, then flush every chunk as it comes.
        if (nextTime === 0 && merged.byteLength < prerollBytes) {
          pending = merged;
          continue;
        }
        const usable = merged.byteLength - (merged.byteLength % frameBytes);
        schedule(merged.subarray(0, usable));
        pending = merged.slice(usable);
      }
      if (pending.byteLength >= frameBytes) schedule(pending);
      if (!anyAudio || nextTime === 0) {
        resolveStarted(null);
        return "failed";
      }
      // Wait for the tail of the last buffer to sound.
      const remaining = Math.max(0, nextTime - context.currentTime);
      await new Promise((resolve) => window.setTimeout(resolve, remaining * 1000 + 50));
      return cancelled ? "cancelled" : "played";
    } catch {
      resolveStarted(null);
      return cancelled ? "cancelled" : "failed";
    }
  })();

  return {
    started,
    done,
    cancel() {
      cancelled = true;
      resolveStarted(null);
      void reader.cancel().catch(() => null);
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already ended.
        }
      }
      sources.clear();
    },
  };
}

export function speechAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// iPhone only lets a page speak after it has spoken inside a tap once.
export function primeSpeech() {
  if (!speechAvailable()) return;
  const utterance = new SpeechSynthesisUtterance(" ");
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

const PREFERRED_VOICES = ["Samantha", "Karen", "Moira", "Daniel", "Google US English", "Microsoft Aria"];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith("en"));
  for (const name of PREFERRED_VOICES) {
    const match = voices.find((voice) => voice.name.startsWith(name));
    if (match) return match;
  }
  return voices.find((voice) => voice.localService) ?? voices[0] ?? null;
}

export type Speech = {
  /** Resolves when the first word starts, with performance.now() at that moment. */
  started: Promise<number | null>;
  done: Promise<SpeechOutcome>;
  cancel: () => void;
};

// Some engines (iOS before priming, embedded WebViews) never fire utterance
// events, which would leave `done` pending forever and wedge the notification
// queue behind it. These watchdogs make `done` always settle.
export const SPEECH_START_TIMEOUT_MS = 4_000;

/** Time to wait for onend after onstart: a base plus a per-character estimate. */
export function speechBudgetMs(text: string, rate: number): number {
  return 8_000 + (text.length * 120) / rate;
}

export function speak(text: string, rate = 0.9): Speech {
  if (!speechAvailable()) {
    return { started: Promise.resolve(null), done: Promise.resolve("failed"), cancel() {} };
  }
  const synth = window.speechSynthesis;
  // One voice at a time: a new answer replaces whatever is still being said.
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.lang = "en-US";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;

  let cancelled = false;
  let resolveStarted: (at: number | null) => void = () => {};
  const started = new Promise<number | null>((resolve) => (resolveStarted = resolve));
  const done = new Promise<SpeechOutcome>((resolve) => {
    let startTimer = 0;
    let endTimer = 0;
    const clearTimers = () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(endTimer);
    };
    // onstart never fired: nothing is speaking, so report failure and let the
    // caller move on instead of blocking the wearer pipeline forever.
    startTimer = window.setTimeout(() => {
      cancelled = true;
      synth.cancel();
      resolveStarted(null);
      resolve("failed");
    }, SPEECH_START_TIMEOUT_MS);
    utterance.onstart = () => {
      window.clearTimeout(startTimer);
      resolveStarted(performance.now());
      // Chrome and WebKit occasionally drop onend; the text did get spoken, so
      // a silent engine still resolves "played" once the estimate runs out.
      endTimer = window.setTimeout(() => {
        synth.cancel();
        resolve(cancelled ? "cancelled" : "played");
      }, speechBudgetMs(text, rate));
    };
    utterance.onend = () => {
      clearTimers();
      resolveStarted(null);
      resolve(cancelled ? "cancelled" : "played");
    };
    utterance.onerror = (event) => {
      clearTimers();
      resolveStarted(null);
      resolve(cancelled || event.error === "interrupted" || event.error === "canceled" ? "cancelled" : "failed");
    };
  });
  synth.speak(utterance);

  return {
    started,
    done,
    cancel() {
      cancelled = true;
      synth.cancel();
    },
  };
}
