// Measures the configured TTS provider from this machine: time to first audio
// byte and total stream duration per run. See PLAN.md "Text to speech:
// ElevenLabs or Deepgram" and "Latency budget" (300 ms budget for first audio).
//
//   pnpm bench:tts [--runs 5] [--text "Your keys are on the kitchen table."]
//
// Reads TTS_PROVIDER, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL
// from apps/web/.env.local, the same as the app.

import { createTTSProvider } from "../apps/web/src/lib/server/tts/index";
import { timedStream } from "../apps/web/src/lib/server/tts/timed-stream";
import "./lib/env";

const DEFAULT_TEXT = "Your keys are on the kitchen table, next to the kettle. I saw them two minutes ago.";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const provider = createTTSProvider();
  if (!provider) {
    throw new Error("No TTS provider configured: set TTS_PROVIDER, ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in apps/web/.env.local");
  }
  const runs = Number(arg("runs") ?? 5);
  const text = arg("text") ?? DEFAULT_TEXT;
  const bytesPerSecond = provider.format.sampleRate * provider.format.channels * 2;
  console.log(`${provider.name}, ${provider.format.encoding} ${provider.format.sampleRate} Hz, ${text.length} chars, ${runs} runs`);

  const firstBytes: number[] = [];
  const totals: number[] = [];
  for (let run = 1; run <= runs; run++) {
    const started = performance.now();
    let firstByte = NaN;
    const stream = timedStream(await provider.synthesize(text), { onFirstByte: (ms) => (firstByte = ms) }, started);
    let bytes = 0;
    for await (const chunk of stream) bytes += chunk.byteLength;
    const total = performance.now() - started;
    firstBytes.push(firstByte);
    totals.push(total);
    const audioSeconds = bytes / bytesPerSecond;
    console.log(`run ${run}: first audio ${firstByte.toFixed(0)} ms, total ${total.toFixed(0)} ms, ${audioSeconds.toFixed(2)} s of audio`);
  }
  console.log(`first audio: P50 ${percentile(firstBytes, 50).toFixed(0)} ms, P95 ${percentile(firstBytes, 95).toFixed(0)} ms`);
  console.log(`total:       P50 ${percentile(totals, 50).toFixed(0)} ms, P95 ${percentile(totals, 95).toFixed(0)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
