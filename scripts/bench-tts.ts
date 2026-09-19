// Races ElevenLabs Flash v2.5 against Deepgram Aura-2 for time-to-first-audio-byte,
// on the network we'll demo on. See README.md "Text to speech: ElevenLabs or Deepgram".
//
// Not implemented: needs the TTSProvider interface (apps/web/src/lib/tts) to exist first.

async function main() {
  throw new Error("not implemented: build the TTSProvider interface before benchmarking it");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
