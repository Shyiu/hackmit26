import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  speak,
  speechBudgetMs,
  SPEECH_START_TIMEOUT_MS,
  type SpeechOutcome,
} from "@/lib/client/speaker";

type FakeUtterance = {
  text: string;
  rate: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

let lastUtterance: FakeUtterance | null;
const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []) };

beforeEach(() => {
  vi.useFakeTimers();
  lastUtterance = null;
  synth.speak.mockImplementation((utterance: FakeUtterance) => {
    lastUtterance = utterance;
  });
  synth.cancel.mockClear();
  vi.stubGlobal("window", {
    speechSynthesis: synth,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      text: string;
      rate = 1;
      lang = "";
      voice = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("speak", () => {
  it("resolves done as failed when onstart never fires, and cancels the engine", async () => {
    const speech = speak("hello");
    let outcome: SpeechOutcome | undefined;
    void speech.done.then((value) => (outcome = value));

    await vi.advanceTimersByTimeAsync(SPEECH_START_TIMEOUT_MS);
    expect(outcome).toBe("failed");
    // cancel once to replace prior speech, once for the watchdog.
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    await expect(speech.started).resolves.toBeNull();
  });

  it("resolves done as played after the budget when onend never arrives", async () => {
    const text = "your keys are on the counter";
    const speech = speak(text, 1);
    let outcome: SpeechOutcome | undefined;
    void speech.done.then((value) => (outcome = value));

    lastUtterance?.onstart?.();
    await expect(speech.started).resolves.toBeTypeOf("number");

    await vi.advanceTimersByTimeAsync(speechBudgetMs(text, 1));
    expect(outcome).toBe("played");
    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });

  it("resolves played on a normal onstart/onend without the watchdog cancelling", async () => {
    const speech = speak("hello", 1);
    let outcome: SpeechOutcome | undefined;
    void speech.done.then((value) => (outcome = value));

    lastUtterance?.onstart?.();
    lastUtterance?.onend?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe("played");
    // Only the initial cancel that clears prior speech.
    expect(synth.cancel).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SPEECH_START_TIMEOUT_MS + speechBudgetMs("hello", 1));
    expect(outcome).toBe("played");
  });

  it("resolves cancelled on cancel() and no later timer flips it", async () => {
    const speech = speak("hello", 1);
    let outcome: SpeechOutcome | undefined;
    void speech.done.then((value) => (outcome = value));

    speech.cancel();
    // The engine fires onerror "interrupted" in response to cancel().
    lastUtterance?.onerror?.({ error: "interrupted" });
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe("cancelled");

    await vi.advanceTimersByTimeAsync(SPEECH_START_TIMEOUT_MS + speechBudgetMs("hello", 1));
    expect(outcome).toBe("cancelled");
  });
});
