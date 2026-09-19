import type { SttOutcome, TurnMode } from "./deepgram";

// The fallback when there's no Deepgram key: the browser's own recognizer.
// Chrome sends the audio to Google, Safari to Apple. It opens its own mic, so
// the page must not hold one open at the same time. Not available inside an
// iOS WKWebView, which is why the app shell needs the Deepgram path.

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => Recognition;

function recognitionClass(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function browserSpeechAvailable() {
  return recognitionClass() !== null;
}

export type BrowserTurn = { finish: () => void; cancel: () => void };

export function openBrowserTurn({
  mode,
  onInterim,
  onDone,
}: {
  mode: TurnMode;
  onInterim: (text: string) => void;
  onDone: (outcome: SttOutcome | { micBlocked: true }) => void;
}): BrowserTurn {
  const Recognition = recognitionClass();
  if (!Recognition) {
    onDone({ error: "This browser has no speech recognition" });
    return { finish() {}, cancel() {} };
  }
  const recognition = new Recognition();
  recognition.lang = "en-US";
  // Hold mode keeps listening through pauses until the wearer lets go.
  recognition.continuous = mode === "hold";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let interimText = "";
  let settled = false;
  let cancelled = false;

  recognition.onresult = (event) => {
    let finals = "";
    let interim = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      if (result.isFinal) finals += `${result[0].transcript} `;
      else interim += result[0].transcript;
    }
    finalText = finals.trim();
    interimText = interim.trim();
    onInterim(`${finalText} ${interimText}`.trim());
  };

  recognition.onerror = (event) => {
    if (settled || cancelled) return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      settled = true;
      onDone({ micBlocked: true });
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      settled = true;
      onDone({ error: `Speech recognition failed: ${event.error}` });
    }
  };

  recognition.onend = () => {
    if (settled || cancelled) return;
    settled = true;
    onDone({ text: (finalText || interimText).trim() });
  };

  recognition.start();

  return {
    finish() {
      if (!settled && !cancelled) recognition.stop();
    },
    cancel() {
      cancelled = true;
      recognition.abort();
    },
  };
}
