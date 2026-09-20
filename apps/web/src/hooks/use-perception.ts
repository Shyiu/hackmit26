import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  serverMessageSchema,
  type CaptureState,
  type Detection,
  type Face,
  type FrameHeader,
} from "@memory-glasses/shared";

// Frames to the perception service over /ws/frames. See the protocol notes in
// packages/shared/src/schemas/perception.ts and PLAN.md "Frame handling".

const FRAMES_PER_SECOND = 3;
const FRAME_WIDTH = 1280;
const JPEG_QUALITY = 0.7;
// A label drawn where the keys were half a second ago is worse than no label.
const MAX_LABEL_AGE_MS = 500;
// Give up waiting on an answer for a frame after this and send the next one.
const FRAME_TIMEOUT_MS = 2000;
const MAX_BACKOFF_MS = 15_000;

export type PerceptionStatus =
  | "off"
  | "unconfigured"
  | "signed-out"
  | "connecting"
  | "connected"
  | "error";

type Token = { token: string; url: string | null };

async function fetchToken(): Promise<Token | "signed-out" | null> {
  try {
    const response = await fetch("/api/perception/token", { cache: "no-store" });
    if (response.status === 401) return "signed-out";
    if (!response.ok) return null;
    return (await response.json()) as Token;
  } catch {
    return null;
  }
}

function encodeFrame(header: FrameHeader, jpeg: ArrayBuffer) {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const message = new Uint8Array(4 + headerBytes.length + jpeg.byteLength);
  new DataView(message.buffer).setUint32(0, headerBytes.length, false);
  message.set(headerBytes, 4);
  message.set(new Uint8Array(jpeg), 4 + headerBytes.length);
  return message;
}

// Shared with use-scan-feed, which grabs its own frames when this socket isn't sending.
export function grabJpeg(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob | null> {
  const width = Math.min(FRAME_WIDTH, video.videoWidth);
  const height = Math.round((video.videoHeight / video.videoWidth) * width);
  if (!width || !height) return Promise.resolve(null);
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

// Streams JPEG frames from `video` while `capturing`, and hands back fresh
// detections for the labels. Capture starts paused on every connection, and a
// reconnect calls `onReconnect` so the page can require an explicit resume
// (PLAN.md "Privacy and safety") -- unless `autoResumeOnReconnect` is set, for
// pages (the /sim dev fallback, not a real wearer device) that want frames to
// keep flowing across a reconnect with no manual step. `onFrame` gets every
// frame that was sent and `onDetections` every answer, keyed by the same seq.
export function usePerception({
  video,
  enabled,
  capturing,
  onReconnect,
  autoResumeOnReconnect = false,
  onFrame,
  onDetections,
}: {
  video: HTMLVideoElement | null;
  enabled: boolean;
  capturing: boolean;
  onReconnect: () => void;
  autoResumeOnReconnect?: boolean;
  onFrame?: (seq: number, jpeg: Blob, capturedAtMs: number) => void;
  onDetections?: (seq: number, detections: Detection[]) => void;
}) {
  const [status, setStatus] = useState<PerceptionStatus>("off");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [faces, setFaces] = useState<Face[]>([]);
  const [facesUpdatedAt, setFacesUpdatedAt] = useState<number | null>(null);
  const [framesSent, setFramesSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const capturingRef = useRef(capturing);
  const videoRef = useRef(video);
  // Never repeats within a page load, so a seq names one frame even across camera restarts.
  // The service only needs it to rise within a connection.
  const seqRef = useRef(0);

  const reconnected = useEffectEvent(() => onReconnect());
  const frameSent = useEffectEvent((seq: number, jpeg: Blob, capturedAtMs: number) =>
    onFrame?.(seq, jpeg, capturedAtMs),
  );
  const detectionsReceived = useEffectEvent((seq: number, found: Detection[]) => onDetections?.(seq, found));

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  // Tell the service when the wearer pauses or resumes.
  useEffect(() => {
    capturingRef.current = capturing;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && sessionRef.current) {
      socket.send(JSON.stringify({ type: "capture", v: 1, state: capturing ? "live" : "paused" }));
    }
  }, [capturing]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let retryTimer: number | null = null;
    let frameTimer: number | null = null;
    let labelTimer: number | null = null;
    let hadSession = false;
    let inFlight: { seq: number; capturedAt: number } | null = null;
    const captured = new Map<number, number>();
    const canvas = document.createElement("canvas");

    function clearLabelsSoon() {
      if (labelTimer !== null) window.clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => setDetections([]), MAX_LABEL_AGE_MS);
    }

    async function sendFrame(socket: WebSocket) {
      const element = videoRef.current;
      const sessionId = sessionRef.current;
      if (!element || !sessionId || !capturingRef.current || socket.readyState !== WebSocket.OPEN) return;
      // One frame in flight at a time; under load the newest frame wins.
      if (inFlight && performance.now() - inFlight.capturedAt < FRAME_TIMEOUT_MS) return;
      if (socket.bufferedAmount > 0) return;
      const capturedAtMs = performance.now();
      const blob = await grabJpeg(element, canvas);
      if (!blob || stopped || socket.readyState !== WebSocket.OPEN) return;
      const jpeg = await blob.arrayBuffer();
      const frameSeq = seqRef.current++;
      const header: FrameHeader = {
        v: 1,
        sessionId,
        seq: frameSeq,
        capturedAtMs,
        sentAtMs: performance.now(),
        width: canvas.width,
        height: canvas.height,
        bytes: jpeg.byteLength,
      };
      inFlight = { seq: frameSeq, capturedAt: capturedAtMs };
      captured.set(frameSeq, capturedAtMs);
      if (captured.size > 32) captured.delete(captured.keys().next().value ?? frameSeq);
      socket.send(encodeFrame(header, jpeg));
      setFramesSent((count) => count + 1);
      frameSent(frameSeq, blob, capturedAtMs);
    }

    async function connect() {
      setStatus("connecting");
      const token = await fetchToken();
      if (stopped) return;
      if (token === "signed-out") {
        setStatus("signed-out");
        return;
      }
      if (!token) return retry("Couldn't get a frame socket token");
      if (!token.url) {
        setStatus("unconfigured");
        return;
      }

      const socket = new WebSocket(token.url);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "hello", v: 1, token: token.token }));
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data !== "string") return;
        let parsed;
        try {
          parsed = serverMessageSchema.safeParse(JSON.parse(event.data));
        } catch {
          return;
        }
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "session") {
          const reconnect = hadSession;
          hadSession = true;
          sessionRef.current = message.sessionId;
          attempt = 0;
          setStatus("connected");
          setError(null);
          if (reconnect && !autoResumeOnReconnect) reconnected();
          // Every session starts paused. After a reconnect it stays paused until
          // the wearer resumes, unless autoResumeOnReconnect says to just keep
          // following the page's own capturing state; on the first connection
          // it always follows the page.
          const state: CaptureState =
            capturingRef.current && (!reconnect || autoResumeOnReconnect) ? "live" : "paused";
          socket.send(JSON.stringify({ type: "capture", v: 1, state }));
        } else if (message.type === "detections") {
          const capturedAt = captured.get(message.seq);
          captured.delete(message.seq);
          if (inFlight?.seq === message.seq) inFlight = null;
          // Before the age check: a late answer is no good as a label but still places the item.
          detectionsReceived(message.seq, message.detections);
          if (capturedAt === undefined || performance.now() - capturedAt > MAX_LABEL_AGE_MS) return;
          setDetections(message.detections);
          clearLabelsSoon();
        } else if (message.type === "faces") {
          // Comes from its own worker (see the protocol notes), so it isn't
          // matched to a captured-frame timestamp the way detections are.
          setFaces(message.faces);
          setFacesUpdatedAt(Date.now());
        } else if (message.type === "error") {
          setError(message.message);
          if (message.code === "unauthorized") setStatus("error");
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        sessionRef.current = null;
        inFlight = null;
        setDetections([]);
        setFaces([]);
        setFacesUpdatedAt(null);
        if (!stopped) retry("The frame socket closed");
      };
    }

    function retry(message: string) {
      setStatus("error");
      setError(message);
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++);
      retryTimer = window.setTimeout(() => void connect(), delay);
    }

    void connect();
    frameTimer = window.setInterval(() => {
      const socket = socketRef.current;
      if (socket) void sendFrame(socket);
    }, 1000 / FRAMES_PER_SECOND);

    return () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (frameTimer !== null) window.clearInterval(frameTimer);
      if (labelTimer !== null) window.clearTimeout(labelTimer);
      socketRef.current?.close();
      socketRef.current = null;
      sessionRef.current = null;
      setStatus("off");
      setDetections([]);
      setFaces([]);
      setFacesUpdatedAt(null);
    };
  }, [enabled, autoResumeOnReconnect]);

  return {
    status: enabled ? status : "off",
    detections,
    faces,
    facesUpdatedAt,
    framesSent,
    error,
  };
}
