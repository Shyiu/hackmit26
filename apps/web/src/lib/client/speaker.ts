// Spoken answers through the browser's speech synthesis, until server TTS
// lands (README "Text to speech"). The rate comes from the wearer's settings,
// where slower than default is the point.

export type SpeechOutcome = "played" | "cancelled" | "failed";

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
    utterance.onstart = () => resolveStarted(performance.now());
    utterance.onend = () => {
      resolveStarted(null);
      resolve(cancelled ? "cancelled" : "played");
    };
    utterance.onerror = (event) => {
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
