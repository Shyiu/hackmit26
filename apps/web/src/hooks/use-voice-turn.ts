import { useCallback, useEffect, useRef, useState } from "react";
import { browserSpeechAvailable, openBrowserTurn } from "@/lib/client/browser-speech";
import { openDeepgramTurn, type SttOutcome, type TurnMode } from "@/lib/client/deepgram";
import { capturePcm, type PcmCapture } from "@/lib/client/pcm-capture";
import { wearerFetch } from "@/lib/client/api";

type AudioSessionType =
  | "auto"
  | "playback"
  | "transient"
  | "transient-solo"
  | "ambient"
  | "play-and-record";

// Safari 17 and later let a page name its audio session instead of having WebKit
// guess from the media calls it makes. Other browsers don't have it.
function setAudioSession(type: AudioSessionType) {
  const session = (navigator as Navigator & { audioSession?: { type: AudioSessionType } })
    .audioSession;
  if (session) session.type = type;
}

// The longest a question stays open. A clicker toggle has no key-up to end it.
const MAX_LISTEN_MS = 15_000;
// Fetch a fresh Deepgram token when the cached one has less than this left.
const TOKEN_MARGIN_MS = 15_000;

export type SpeechEngine = "deepgram" | "browser" | "none";

export type TurnResult =
  | { kind: "transcript"; text: string }
  | { kind: "empty" }
  | { kind: "cancelled" }
  | { kind: "mic-blocked" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

type SttToken = { token: string; model: string; expiresAt: number };

type ActiveTurn = {
  id: number;
  finishRequested: boolean;
  finish: () => void;
  cancel: () => void;
  cleanup: () => void;
};

async function fetchSttToken(): Promise<SttToken | null> {
  try {
    const response = await wearerFetch("/api/stt/token", { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { token: string; model: string; expiresAt: string };
    return { token: body.token, model: body.model, expiresAt: Date.parse(body.expiresAt) };
  } catch {
    return null;
  }
}

function toResult(outcome: SttOutcome): TurnResult {
  if ("error" in outcome) return { kind: "error", message: outcome.error };
  return outcome.text ? { kind: "transcript", text: outcome.text } : { kind: "empty" };
}

// One spoken question: open the mic, stream it to speech to text, and report
// the transcript when the turn ends. Deepgram when the server has a key, the
// browser's recognizer when it doesn't. The mic is open only during the turn;
// on iPhone an open mic pulls answer audio into the earpiece.
//
// "auto" ends the turn when the wearer stops talking (the chest page's tap to
// ask). "hold" ends it on release (the simulator's hold-to-talk button).
export function useVoiceTurn({
  mode,
  getAudioContext,
  onTurnEnd,
}: {
  mode: TurnMode;
  getAudioContext: () => AudioContext;
  onTurnEnd: (result: TurnResult) => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [engine, setEngine] = useState<SpeechEngine | null>(null);
  const [micAllowed, setMicAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<SpeechEngine | null>(null);
  const tokenRef = useRef<SttToken | null>(null);
  const activeRef = useRef<ActiveTurn | null>(null);
  const turnIdRef = useRef(0);
  const onTurnEndRef = useRef(onTurnEnd);
  const getAudioContextRef = useRef(getAudioContext);

  useEffect(() => {
    onTurnEndRef.current = onTurnEnd;
    getAudioContextRef.current = getAudioContext;
  });

  const probe = useCallback(async (): Promise<SpeechEngine> => {
    const token = await fetchSttToken();
    if (token) tokenRef.current = token;
    const found: SpeechEngine = token ? "deepgram" : browserSpeechAvailable() ? "browser" : "none";
    engineRef.current = found;
    setEngine(found);
    return found;
  }, []);

  const end = useCallback((id: number, result: TurnResult) => {
    const active = activeRef.current;
    if (!active || active.id !== id) return;
    activeRef.current = null;
    active.cleanup();
    setAudioSession("auto");
    setListening(false);
    setInterim("");
    if (result.kind === "mic-blocked") setError("Microphone permission was denied.");
    onTurnEndRef.current(result);
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    const id = ++turnIdRef.current;
    let finishImpl: () => void = () => {};
    let cancelImpl: () => void = () => {};
    let cleanupImpl: () => void = () => {};
    const turn: ActiveTurn = {
      id,
      finishRequested: false,
      finish: () => {
        turn.finishRequested = true;
        finishImpl();
      },
      cancel: () => cancelImpl(),
      cleanup: () => cleanupImpl(),
    };
    activeRef.current = turn;
    setListening(true);
    setInterim("");
    const timer = window.setTimeout(() => turn.finish(), MAX_LISTEN_MS);
    cleanupImpl = () => window.clearTimeout(timer);

    const chosen = engineRef.current ?? (await probe());
    if (activeRef.current !== turn) return;

    if (chosen === "none") {
      end(id, { kind: "unavailable" });
      return;
    }

    if (chosen === "browser") {
      const browserTurn = openBrowserTurn({
        mode,
        onInterim: (text) => activeRef.current === turn && setInterim(text),
        onDone: (outcome) => end(id, "micBlocked" in outcome ? { kind: "mic-blocked" } : toResult(outcome)),
      });
      finishImpl = browserTurn.finish;
      cancelImpl = browserTurn.cancel;
      if (turn.finishRequested) browserTurn.finish();
      return;
    }

    // Deepgram: the mic and the token open together, and audio captured before
    // the socket is up waits in a queue, so the first words aren't lost.
    setAudioSession("play-and-record");
    const cached = tokenRef.current;
    const tokenPromise =
      cached && cached.expiresAt - Date.now() > TOKEN_MARGIN_MS ? Promise.resolve(cached) : fetchSttToken();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      });
    } catch {
      end(id, { kind: "mic-blocked" });
      return;
    }
    setMicAllowed(true);
    const stopStream = () => stream.getTracks().forEach((track) => track.stop());
    if (activeRef.current !== turn) {
      stopStream();
      return;
    }

    const token = await tokenPromise;
    if (activeRef.current !== turn) {
      stopStream();
      return;
    }
    if (!token) {
      stopStream();
      end(id, { kind: "error", message: "Couldn't get a speech to text token" });
      return;
    }
    tokenRef.current = token;

    const socketTurn = openDeepgramTurn({
      token: token.token,
      model: token.model,
      mode,
      onInterim: (text) => activeRef.current === turn && setInterim(text),
      onDone: (outcome) => end(id, toResult(outcome)),
    });
    let capture: PcmCapture | null = null;
    cleanupImpl = () => {
      window.clearTimeout(timer);
      capture?.stop();
      stopStream();
    };
    cancelImpl = socketTurn.cancel;
    finishImpl = () => {
      // Flush the last partial chunk before asking Deepgram to finalize.
      capture?.stop();
      capture = null;
      stopStream();
      socketTurn.finish();
    };
    try {
      capture = await capturePcm(getAudioContextRef.current(), stream, socketTurn.send);
    } catch (err) {
      socketTurn.cancel();
      end(id, { kind: "error", message: err instanceof Error ? err.message : "Couldn't read the microphone" });
      return;
    }
    if (activeRef.current !== turn) {
      capture.stop();
      return;
    }
    if (turn.finishRequested) finishImpl();
  }, [end, mode, probe]);

  /** Ends the turn now and keeps what was heard. Hold mode calls this on release. */
  const finish = useCallback(() => activeRef.current?.finish(), []);

  /** Drops the turn. Nothing gets asked. */
  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    active.cancel();
    end(active.id, { kind: "cancelled" });
  }, [end]);

  // Ask for mic permission and find a speech engine up front, so the first
  // question doesn't stop at a permission prompt. The mic closes again at once.
  const prime = useCallback(async () => {
    void probe();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone access needs HTTPS.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((track) => track.stop());
      setMicAllowed(true);
      setError(null);
      return true;
    } catch {
      setError("Microphone permission was denied.");
      return false;
    }
  }, [probe]);

  useEffect(
    () => () => {
      activeRef.current?.cancel();
      activeRef.current?.cleanup();
      activeRef.current = null;
    },
    [],
  );

  return { listening, interim, engine, micAllowed, error, start, finish, cancel, prime };
}
