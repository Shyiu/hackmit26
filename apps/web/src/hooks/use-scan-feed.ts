import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Detection, ScanLiveState } from "@memory-glasses/shared";
import { getScanLive, postScanFrame, postScanObservations } from "@/lib/client/api";
import { grabJpeg } from "./use-perception";

// Feeds the live 3D room scan: camera frames go to splat-slam through
// /api/scan/live/frames, and a detection on a frame the server kept becomes an
// observation, so the item gets a spot in the room once that frame has a pose.

const FRAME_GAP_MS = 500;
const CHECK_MS = 30_000;
const SCANNING_CHECK_MS = 10_000;
// Perception quiet for this long means it isn't sending, so grab frames here.
const QUIET_MS = 1500;
const MAX_KEPT_FRAMES = 200;
const OBSERVATION_GAP_MS = 3000;
const MAX_OBSERVATIONS = 20;
const MAX_FAILURES = 3;
const ITEM_ID = /^[0-9a-f]{24}$/;

const UNREACHABLE: ScanLiveState = { configured: true, reachable: false, sceneId: null, scene: null };

export type ScanFeedStatus = "off" | "unconfigured" | "scanning" | "error";

type KeptFrame = { sceneId: string; name: string; seenAt: string };

type Feed = {
  active: boolean;
  inFlight: boolean;
  inFlightSeq: number | null;
  // Detections that beat their frame's upload back.
  early: Detection[] | null;
  lastSentAt: number;
  lastPerceptionAt: number;
  failures: number;
  sessionBase: string;
  sessionPart: number;
  frameSize: string;
  kept: Map<number, KeptFrame>;
  observedAt: Map<string, number>;
};

// Not crypto.randomUUID: that only exists on a secure origin, and /wear opened over plain
// http on a LAN address still has to render to say the camera needs HTTPS.
function sessionBase() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return Array.from(words, (word) => word.toString(36)).join("").padEnd(8, "0").slice(0, 8);
}

function feedOf(ref: RefObject<Feed | null>) {
  return (ref.current ??= {
    active: false,
    inFlight: false,
    inFlightSeq: null,
    early: null,
    lastSentAt: -Infinity,
    lastPerceptionAt: -Infinity,
    failures: 0,
    sessionBase: sessionBase(),
    sessionPart: 0,
    frameSize: "",
    kept: new Map(),
    observedAt: new Map(),
  });
}

// One splat-slam session is one camera. A turned phone sends a different frame
// size, which is a different camera, so it gets a new session.
function sessionFor(feed: Feed, video: HTMLVideoElement | null) {
  const size = video ? `${video.videoWidth}x${video.videoHeight}` : feed.frameSize;
  if (size !== feed.frameSize) {
    if (feed.frameSize) feed.sessionPart++;
    feed.frameSize = size;
  }
  return `${feed.sessionBase}-${feed.sessionPart}`;
}

function observe(feed: Feed, frame: KeptFrame, detections: Detection[]) {
  const now = performance.now();
  const observations: { itemId: string; u: number; v: number }[] = [];
  for (const { itemId, bbox } of detections) {
    if (observations.length === MAX_OBSERVATIONS) break;
    if (!ITEM_ID.test(itemId) || now - (feed.observedAt.get(itemId) ?? -Infinity) < OBSERVATION_GAP_MS) continue;
    feed.observedAt.set(itemId, now);
    const [x, y, w, h] = bbox;
    observations.push({ itemId, u: clampUnit(x + w / 2), v: clampUnit(y + h / 2) });
  }
  if (observations.length === 0) return;
  postScanObservations({ sceneId: frame.sceneId, frame: frame.name, seenAt: frame.seenAt, observations }).catch(() => {
    for (const { itemId } of observations) feed.observedAt.delete(itemId);
  });
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

function count(scene: ScanLiveState["scene"], key: string) {
  const value = scene?.[key];
  return typeof value === "number" ? value : 0;
}

// `onFrame` and `onDetections` go to usePerception. While that socket isn't
// sending, this grabs its own frames from `video`; those place no items, since
// detections only come back for perception's frames.
export function useScanFeed({
  video,
  enabled,
  capturing,
}: {
  video: HTMLVideoElement | null;
  enabled: boolean;
  capturing: boolean;
}) {
  const [live, setLive] = useState<ScanLiveState | null>(null);
  const [failing, setFailing] = useState(false);
  const [keptHere, setKeptHere] = useState(0);
  const feedRef = useRef<Feed | null>(null);
  const videoRef = useRef(video);

  const active = enabled && capturing && live !== null && live.configured && live.reachable && !failing;

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  useEffect(() => {
    const feed = feedOf(feedRef);
    feed.active = active;
    // A frame still being encoded at unmount must not go out.
    return () => {
      feed.active = false;
    };
  }, [active]);

  useEffect(() => {
    if (!enabled) return;
    const opened = feedOf(feedRef);
    // Each camera open is a new session: a lens switch keeps the frame size but not the
    // focal length, and splat-slam gives a session one set of intrinsics.
    if (opened.frameSize) {
      opened.sessionPart++;
      opened.frameSize = "";
    }
    let stopped = false;
    let timer: number | null = null;
    async function check() {
      const next = await getScanLive().catch(() => UNREACHABLE);
      if (stopped) return;
      const feed = feedOf(feedRef);
      setLive(next);
      setKeptHere(0);
      if (next.reachable) {
        feed.failures = 0;
        setFailing(false);
      }
      timer = window.setTimeout(() => void check(), feed.active ? SCANNING_CHECK_MS : CHECK_MS);
    }
    void check();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      // Frames of the run that just ended must not pair with the next run's detections.
      opened.kept.clear();
      opened.early = null;
    };
  }, [enabled]);

  // At most one upload at a time and two a second. Anything else is dropped.
  const send = useCallback(async (seq: number | null, jpeg: Blob, capturedAtMs: number) => {
    const feed = feedOf(feedRef);
    const now = performance.now();
    if (!feed.active || feed.inFlight || now - feed.lastSentAt < FRAME_GAP_MS) return;
    feed.inFlight = true;
    feed.inFlightSeq = seq;
    feed.early = null;
    feed.lastSentAt = now;
    const seenAt = new Date().toISOString();
    try {
      const result = await postScanFrame(jpeg, sessionFor(feed, videoRef.current), capturedAtMs / 1000);
      feed.failures = 0;
      if (result.kept) setKeptHere((kept) => kept + 1);
      if (result.kept && result.name && seq !== null) {
        const frame = { sceneId: result.sceneId, name: result.name, seenAt };
        feed.kept.set(seq, frame);
        if (feed.kept.size > MAX_KEPT_FRAMES) feed.kept.delete(feed.kept.keys().next().value ?? seq);
        if (feed.early) observe(feed, frame, feed.early);
      }
    } catch {
      if (++feed.failures >= MAX_FAILURES) setFailing(true);
    } finally {
      feed.inFlight = false;
      feed.inFlightSeq = null;
      feed.early = null;
    }
  }, []);

  const onFrame = useCallback(
    (seq: number, jpeg: Blob, capturedAtMs: number) => {
      feedOf(feedRef).lastPerceptionAt = performance.now();
      void send(seq, jpeg, capturedAtMs);
    },
    [send],
  );

  const onDetections = useCallback((seq: number, detections: Detection[]) => {
    if (detections.length === 0) return;
    const feed = feedOf(feedRef);
    const frame = feed.kept.get(seq);
    if (frame) observe(feed, frame, detections);
    else if (feed.inFlightSeq === seq) feed.early = detections;
  }, []);

  useEffect(() => {
    if (!active || !video) return;
    const element = video;
    const canvas = document.createElement("canvas");
    // Ticks twice per gap, so timer jitter can't push a frame under the gap and lose it.
    const timer = window.setInterval(async () => {
      const feed = feedOf(feedRef);
      const capturedAtMs = performance.now();
      if (feed.inFlight || capturedAtMs - feed.lastSentAt < FRAME_GAP_MS) return;
      if (capturedAtMs - feed.lastPerceptionAt < QUIET_MS) return;
      const jpeg = await grabJpeg(element, canvas);
      if (jpeg) void send(null, jpeg, capturedAtMs);
    }, FRAME_GAP_MS / 2);
    return () => window.clearInterval(timer);
  }, [active, video, send]);

  const status: ScanFeedStatus =
    !enabled || !live
      ? "off"
      : !live.configured
        ? "unconfigured"
        : !live.reachable || failing
          ? "error"
          : capturing
            ? "scanning"
            : "off";
  const scene = enabled ? (live?.scene ?? null) : null;

  return {
    status,
    // The scene's count as of the last check, plus what this page added since.
    kept: count(scene, "kept") + (enabled ? keptHere : 0),
    registered: count(scene, "registered"),
    splatVersion: count(scene, "splat_version"),
    onFrame,
    onDetections,
  };
}
