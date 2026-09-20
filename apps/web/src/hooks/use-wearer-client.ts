import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { TurnMode } from "@/lib/client/deepgram";
import {
  pcmFormatFromHeaders,
  playPcmStream,
  primeSpeech,
  speak,
  type Speech,
  type SpeechOutcome,
} from "@/lib/client/speaker";
import { playListeningChime, playStallTone } from "@/lib/tones";
import { CAMERA_SETTING, parseCameraChoice, useCamera, type CameraChoice } from "./use-camera";
import { useHudMessage } from "./use-hud-message";
import { usePerception } from "./use-perception";
import { useRecorder } from "./use-recorder";
import { enterFullscreen, useWakeLock } from "./use-screen";
import { readStoredString, writeStoredString } from "./use-stored-setting";
import { useFeedWatchdog } from "./use-video-frames";
import { useVoiceTurn, type TurnResult } from "./use-voice-turn";

type WearerSettings = { speakingRate: number; recordingAllowed: boolean };
type InteractionView = { _id: string; status: string; answerText?: string };
type NotificationView = { _id: string; text: string };

export type AnswerState = "idle" | "thinking" | "speaking";

// Calm words for system trouble. The caregiver sees the real error on the dashboard.
const TROUBLE = "I need a moment.";
const POLL_MS = 300;
const POLL_LIMIT_MS = 8000;
const NOTIFICATION_POLL_MS = 5000;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Polls an interaction until it settles. Server TTS answers carry only audio,
// so the caption text comes from here while the voice is already playing.
async function fetchInteraction(id: string): Promise<InteractionView> {
  const poll = await fetch(`/api/interactions/${id}`, { cache: "no-store" });
  if (!poll.ok) throw new Error(`Polling the answer failed with ${poll.status}`);
  return (await poll.json()) as InteractionView;
}

async function pollInteraction(interaction: InteractionView, settled: (status: string) => boolean) {
  const deadline = performance.now() + POLL_LIMIT_MS;
  while (!settled(interaction.status) && performance.now() < deadline) {
    await sleep(POLL_MS);
    interaction = await fetchInteraction(interaction._id);
  }
  return interaction;
}

const isFinal = (status: string) => status !== "generating" && status !== "streaming";

type ServerAnswer =
  | { kind: "text"; interaction: InteractionView }
  | { kind: "audio"; interactionId: string; body: ReadableStream<Uint8Array>; format: { sampleRate: number; channels: number } };

async function askServer(transcript: string): Promise<ServerAnswer> {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcript, requestId: crypto.randomUUID() }),
  });
  if (!response.ok) throw new Error(`Ask failed with ${response.status}`);
  const format = pcmFormatFromHeaders(response.headers);
  const interactionId = response.headers.get("x-interaction-id");
  if (format && response.body && interactionId) {
    return { kind: "audio", interactionId, body: response.body, format };
  }
  // 202: an earlier attempt with this request is still running. Poll it.
  const interaction = await pollInteraction((await response.json()) as InteractionView, isFinal);
  if (interaction.status !== "complete" || !interaction.answerText) {
    throw new Error(`The answer ended as ${interaction.status}`);
  }
  return { kind: "text", interaction };
}

function reportPlayback(interactionId: string, outcome: SpeechOutcome, firstPlaybackMs: number | null) {
  const body = {
    outcome: outcome === "played" ? "played" : outcome === "cancelled" ? "cancelled" : "failed",
    ...(firstPlaybackMs !== null && { clientFirstPlaybackMs: Math.min(60_000, Math.round(firstPlaybackMs)) }),
  };
  void fetch(`/api/interactions/${interactionId}/playback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

// Settings the wearer page needs. A 401 means nobody has signed in on this phone.
function useWearerSettings() {
  const [settings, setSettings] = useState<WearerSettings | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401) {
          setSignedIn(false);
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as { settings: WearerSettings };
        if (cancelled) return;
        setSignedIn(true);
        setSettings(body.settings);
      } catch {
        // Offline for a moment; the next poll catches up.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { settings, signedIn };
}

// Everything the wearer's phone does, shared by /wear and /sim: camera,
// recording, frame upload, the question-and-answer loop, spoken caregiver
// messages, wake lock, and the stalled-feed watchdog. The pages only differ in
// what they draw and how a question starts: tap to ask on the chest ("auto"),
// hold to ask on the flat page ("hold"). `autoResumeOnReconnect` skips the
// require-an-explicit-resume-after-a-reconnect privacy step (README "Privacy
// and safety") -- /sim, a laptop dev/testing fallback, sets it so its stream
// to the db never silently stops; /wear, a real wearer's chest camera, doesn't.
export function useWearerClient({
  turnMode,
  fullscreen = false,
  autoResumeOnReconnect = false,
}: {
  turnMode: TurnMode;
  fullscreen?: boolean;
  autoResumeOnReconnect?: boolean;
}) {
  const camera = useCamera();
  const recorder = useRecorder(camera.stream);
  const hud = useHudMessage();
  const { settings, signedIn } = useWearerSettings();
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [answer, setAnswer] = useState<AnswerState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const speechRef = useRef<Speech | null>(null);
  const answerSeqRef = useRef(0);
  const notificationRef = useRef<string | null>(null);

  const live = camera.status === "live";
  // Once the camera has been started, keep watching even if it errors out.
  const started = camera.status !== "idle";
  const rate = settings?.speakingRate ?? 0.9;
  const recordingAllowed = settings?.recordingAllowed ?? false;

  const wakeLock = useWakeLock(started);
  // A camera that never opened shows its own error; the stall card is for a
  // feed that was running and froze.
  const stalled = useFeedWatchdog(video, started) && camera.stream !== null;

  // On iPhone an AudioContext only makes sound if it's resumed inside a tap.
  const resumeAudio = useCallback(() => {
    audioRef.current ??= new AudioContext();
    void audioRef.current.resume();
    return audioRef.current;
  }, []);

  const stopSpeaking = useCallback(() => {
    speechRef.current?.cancel();
    speechRef.current = null;
  }, []);

  // Say something and show it word for word. Resolves when it's done.
  const say = useCallback(
    async (text: string) => {
      stopSpeaking();
      hud.show("caption", text);
      const speech = speak(text, rate);
      speechRef.current = speech;
      const startedAt = await speech.started;
      const outcome = await speech.done;
      if (speechRef.current === speech) speechRef.current = null;
      return { startedAt, outcome };
    },
    [hud, rate, stopSpeaking],
  );

  // Server TTS: play the PCM as it streams in, and caption it from the polled
  // interaction. Cancelling here also closes the response, which cancels upstream.
  const playStream = useCallback(
    async (answer: Extract<ServerAnswer, { kind: "audio" }>) => {
      stopSpeaking();
      const speech = playPcmStream(answer.body, resumeAudio(), answer.format);
      speechRef.current = speech;
      // The text is already stored by the time the audio headers arrive; one fetch usually does it.
      const caption = fetchInteraction(answer.interactionId)
        .then((interaction) => pollInteraction(interaction, (status) => status !== "generating"))
        .then((interaction) => {
          if (speechRef.current === speech && interaction.answerText) hud.show("caption", interaction.answerText);
        })
        .catch(() => null);
      const startedAt = await speech.started;
      const outcome = await speech.done;
      await caption;
      if (speechRef.current === speech) speechRef.current = null;
      return { startedAt, outcome };
    },
    [hud, resumeAudio, stopSpeaking],
  );

  const answerQuestion = useCallback(
    async (transcript: string, turnEndedAt: number) => {
      const seq = ++answerSeqRef.current;
      setLastQuestion(transcript);
      setAnswer("thinking");
      let answer: ServerAnswer;
      try {
        answer = await askServer(transcript);
      } catch (error) {
        if (seq !== answerSeqRef.current) return;
        setLastError(error instanceof Error ? error.message : String(error));
        setAnswer("speaking");
        await say(TROUBLE);
        if (seq === answerSeqRef.current) setAnswer("idle");
        return;
      }
      // A newer question already started; this answer is stale.
      if (seq !== answerSeqRef.current) {
        if (answer.kind === "audio") void answer.body.cancel().catch(() => null);
        return;
      }
      setLastError(null);
      setAnswer("speaking");
      if (answer.kind === "text") {
        const { startedAt, outcome } = await say(answer.interaction.answerText ?? TROUBLE);
        reportPlayback(answer.interaction._id, outcome, startedAt === null ? null : startedAt - turnEndedAt);
      } else {
        const { startedAt, outcome } = await playStream(answer);
        reportPlayback(answer.interactionId, outcome, startedAt === null ? null : startedAt - turnEndedAt);
      }
      if (seq === answerSeqRef.current) setAnswer("idle");
    },
    [playStream, say],
  );

  const onTurnEnd = useCallback(
    (result: TurnResult) => {
      switch (result.kind) {
        case "transcript":
          void answerQuestion(result.text, performance.now());
          break;
        case "empty":
          void say("I didn't hear a question.");
          break;
        case "mic-blocked":
          hud.show("caption", "The microphone is blocked.");
          break;
        case "unavailable":
          hud.show("caption", "Speech to text isn't set up on this phone.");
          break;
        case "error":
          setLastError(result.message);
          void say(TROUBLE);
          break;
        case "cancelled":
          break;
      }
    },
    [answerQuestion, hud, say],
  );

  const voice = useVoiceTurn({ mode: turnMode, getAudioContext: resumeAudio, onTurnEnd });

  const perception = usePerception({
    video,
    enabled: live && signedIn === true,
    capturing,
    autoResumeOnReconnect,
    onReconnect: () => {
      setCapturing(false);
      recorder.stop();
      hud.show("notice", "Capture paused after a reconnect.");
    },
  });

  /** The first tap: camera, mic permission, sound, and speech all need it. */
  const start = useCallback(async () => {
    // These need the tap that got us here, so they go before the first await.
    resumeAudio();
    primeSpeech();
    if (fullscreen) void enterFullscreen();
    const opened = await camera.start(parseCameraChoice(readStoredString(CAMERA_SETTING)));
    await voice.prime();
    return opened;
  }, [camera, fullscreen, resumeAudio, voice]);

  const changeCamera = useCallback(
    (choice: CameraChoice) => {
      writeStoredString(CAMERA_SETTING, JSON.stringify(choice));
      void camera.start(choice);
    },
    [camera],
  );

  /** Starts a question. Stops any answer still being spoken. */
  const beginTurn = useCallback(() => {
    if (!live || voice.listening) return;
    answerSeqRef.current++;
    stopSpeaking();
    setAnswer("idle");
    // The answer is spoken after an await, outside this tap, so unlock speech now.
    primeSpeech();
    playListeningChime(resumeAudio());
    void voice.start();
  }, [live, resumeAudio, stopSpeaking, voice]);

  /** Tap to ask, tap again to cancel. The chest page and clickers use this. */
  const toggleTurn = useCallback(() => {
    if (voice.listening) voice.cancel();
    else beginTurn();
  }, [beginTurn, voice]);

  /** A typed question, for the simulator and for testing without speech. */
  const askText = useCallback(
    (text: string) => {
      const transcript = text.trim();
      if (!transcript) return;
      resumeAudio();
      primeSpeech();
      stopSpeaking();
      void answerQuestion(transcript, performance.now());
    },
    [answerQuestion, resumeAudio, stopSpeaking],
  );

  const resume = useCallback(() => setCapturing(true), []);
  const pause = useCallback(() => {
    setCapturing(false);
    recorder.stop();
  }, [recorder]);

  const startRecording = useCallback(() => {
    if (recordingAllowed && capturing) recorder.start();
  }, [capturing, recorder, recordingAllowed]);

  // The stall tone repeats so a spotter hears it too, not only the wearer.
  const onStall = useEffectEvent(() => {
    if (audioRef.current) playStallTone(audioRef.current);
  });
  useEffect(() => {
    if (!stalled) return;
    onStall();
    const timer = window.setInterval(() => onStall(), 3000);
    return () => window.clearInterval(timer);
  }, [stalled]);

  // Caregiver messages and due reminders: spoken, then shown as a caption. They
  // wait while the wearer is asking or hearing an answer, and stay queued on
  // the server until marked shown.
  const checkNotifications = useEffectEvent(async () => {
    if (voice.listening || answer !== "idle" || notificationRef.current) return;
    const response = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const { notification } = (await response.json()) as { notification: NotificationView | null };
    if (!notification || notificationRef.current) return;
    notificationRef.current = notification._id;
    try {
      const { outcome } = await say(notification.text);
      if (outcome !== "cancelled") {
        await fetch(`/api/notifications/${notification._id}/shown`, { method: "POST" }).catch(() => null);
      }
    } finally {
      notificationRef.current = null;
    }
  });
  useEffect(() => {
    if (!live || signedIn !== true) return;
    const timer = window.setInterval(() => void checkNotifications(), NOTIFICATION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, signedIn]);

  useEffect(() => () => speechRef.current?.cancel(), []);

  return {
    camera,
    recorder,
    hud,
    voice,
    perception,
    wakeLock,
    signedIn,
    settings,
    live,
    started,
    stalled,
    capturing,
    answer,
    lastQuestion,
    lastError,
    recordingAllowed,
    video,
    setVideo,
    start,
    changeCamera,
    beginTurn,
    toggleTurn,
    finishTurn: voice.finish,
    askText,
    resume,
    pause,
    startRecording,
    stopSpeaking,
  };
}

export type WearerClient = ReturnType<typeof useWearerClient>;
