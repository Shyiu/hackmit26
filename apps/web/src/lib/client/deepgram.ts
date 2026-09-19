import { PCM_SAMPLE_RATE } from "./pcm-capture";

// One question over Deepgram's streaming socket. README "What happens when the
// wearer asks a question": finalized segments accumulate until the turn ends.
// `is_final` alone doesn't end it. In "auto" mode the turn ends when Deepgram
// marks `speech_final` or sends UtteranceEnd. In "hold" mode it ends when
// the wearer lets go and Finalize flushes the last words.

export type TurnMode = "auto" | "hold";

export type SttOutcome = { text: string } | { error: string };

type ResultsMessage = {
  type: "Results";
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
};

type DeepgramMessage = ResultsMessage | { type: "UtteranceEnd" } | { type: string };

// Initial silence window from README "Latency budget". People with dementia
// often pause mid-sentence, so tune it with real speech before shortening it.
const ENDPOINTING_MS = 400;
// Deepgram's minimum. The fallback for when speech_final never comes.
const UTTERANCE_END_MS = 1000;
// If Finalize gets no answer, go with what has arrived.
const FINALIZE_TIMEOUT_MS = 1500;

export type DeepgramTurn = {
  send: (pcm: ArrayBuffer) => void;
  finish: () => void;
  cancel: () => void;
};

export function openDeepgramTurn({
  token,
  model,
  mode,
  onInterim,
  onDone,
}: {
  token: string;
  model: string;
  mode: TurnMode;
  onInterim: (text: string) => void;
  onDone: (outcome: SttOutcome) => void;
}): DeepgramTurn {
  const params = new URLSearchParams({
    model,
    language: "en",
    encoding: "linear16",
    sample_rate: String(PCM_SAMPLE_RATE),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    endpointing: String(ENDPOINTING_MS),
    utterance_end_ms: String(UTTERANCE_END_MS),
    vad_events: "true",
  });
  // Browsers can't set headers on a WebSocket; Deepgram reads a temporary
  // token from the subprotocol instead.
  const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["bearer", token]);
  socket.binaryType = "arraybuffer";

  const queued: ArrayBuffer[] = [];
  const finals: string[] = [];
  let finishing = false;
  let settled = false;
  let finishTimer: number | null = null;

  const transcript = () => finals.join(" ").replace(/\s+/g, " ").trim();

  function settle(outcome: SttOutcome | null) {
    if (settled) return;
    settled = true;
    if (finishTimer !== null) window.clearTimeout(finishTimer);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    socket.close();
    if (outcome) onDone(outcome);
  }

  function requestFinalize() {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Finalize" }));
  }

  socket.onopen = () => {
    for (const chunk of queued) socket.send(chunk);
    queued.length = 0;
    if (finishing) requestFinalize();
  };

  socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
    if (typeof event.data !== "string") return;
    let message: DeepgramMessage;
    try {
      message = JSON.parse(event.data) as DeepgramMessage;
    } catch {
      return;
    }
    if (message.type === "Results") {
      const result = message as ResultsMessage;
      const text = result.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      if (result.is_final) {
        if (text) finals.push(text);
        onInterim(transcript());
      } else {
        onInterim([...finals, text].join(" ").trim());
      }
      if (finishing && result.from_finalize) settle({ text: transcript() });
      else if (mode === "auto" && result.speech_final && finals.length > 0) settle({ text: transcript() });
    } else if (message.type === "UtteranceEnd" && mode === "auto" && finals.length > 0) {
      settle({ text: transcript() });
    }
  };

  socket.onerror = () => settle({ error: "Lost the connection to speech to text" });
  socket.onclose = (event) => {
    if (settled) return;
    // A close before the turn ended: keep what was heard, if anything.
    settle(finals.length > 0 ? { text: transcript() } : { error: `Speech to text closed (${event.code})` });
  };

  return {
    send(pcm) {
      if (settled) return;
      if (socket.readyState === WebSocket.OPEN) socket.send(pcm);
      else if (socket.readyState === WebSocket.CONNECTING) queued.push(pcm);
    },
    finish() {
      if (settled || finishing) return;
      finishing = true;
      requestFinalize();
      finishTimer = window.setTimeout(() => settle({ text: transcript() }), FINALIZE_TIMEOUT_MS);
    },
    cancel() {
      settle(null);
    },
  };
}
