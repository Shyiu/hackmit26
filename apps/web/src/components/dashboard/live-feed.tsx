"use client";

import { useEffect, useState } from "react";
import { debugServerMessageSchema, type Detection, type Face } from "@memory-glasses/shared";
import { FaceLabels, ItemLabels } from "@/components/wearer/hud";

type DebugToken = { token: string; url: string | null };

async function fetchDebugToken(): Promise<DebugToken | "signed-out" | null> {
  try {
    const response = await fetch("/api/perception/debug-token", { cache: "no-store" });
    if (response.status === 401) return "signed-out";
    if (!response.ok) return null;
    return (await response.json()) as DebugToken;
  } catch {
    return null;
  }
}

type Status = "connecting" | "connected" | "waiting" | "unconfigured" | "signed-out" | "error";

const STATUS_TEXT: Record<Exclude<Status, "connected">, string> = {
  connecting: "Connecting to the live feed…",
  waiting: "Connected. Waiting for the phone to send frames — is capture live on /wear or /sim?",
  unconfigured: "The perception service isn't configured for this deployment.",
  "signed-out": "Sign in to see the live feed.",
  error: "The live feed hit an error.",
};

const RETRY_MS = 3000;

/**
 * Connects to /ws/debug for the same detections and faces the wearer's phone
 * gets, on a downscaled copy of each frame it actually processes -- so this is
 * silent whenever capture is paused, same as the wearer's own labels are.
 * Debug-only: nothing here is stored, and the socket only exists while this
 * component is mounted (the Live view tab is open).
 */
function useDebugFeed() {
  const [status, setStatus] = useState<Status>("connecting");
  const [frame, setFrame] = useState<{ src: string; width: number; height: number } | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [faces, setFaces] = useState<Face[]>([]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;

    function retry() {
      if (stopped) return;
      retryTimer = window.setTimeout(() => void connect(), RETRY_MS);
    }

    async function connect() {
      setStatus("connecting");
      const token = await fetchDebugToken();
      if (stopped) return;
      if (token === "signed-out") {
        setStatus("signed-out");
        return;
      }
      if (!token) return retry();
      if (!token.url) {
        setStatus("unconfigured");
        return;
      }

      socket = new WebSocket(token.url);
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: "hello", v: 1, token: token.token }));
        // /ws/debug sends no ack on a successful hello -- it stays silent until a
        // frame arrives, by design, so this is optimistic. A rejected hello closes
        // the socket right after (see onclose), which corrects it.
        setStatus("waiting");
      };
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data !== "string") return;
        let parsed;
        try {
          parsed = debugServerMessageSchema.safeParse(JSON.parse(event.data));
        } catch {
          return;
        }
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "debug_frame") {
          setStatus("connected");
          setFrame({ src: `data:image/jpeg;base64,${message.jpeg}`, width: message.width, height: message.height });
          setDetections(message.detections);
        } else if (message.type === "faces") {
          setFaces(message.faces);
        } else if (message.type === "error") {
          setStatus("error");
        }
      };
      socket.onclose = (event) => {
        if (event.code === 4401) setStatus("error");
        retry();
      };
      socket.onerror = () => socket?.close();
    }

    void connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  return { status, frame, detections, faces } as const;
}

export function LiveFeed() {
  const { status, frame, detections, faces } = useDebugFeed();
  const aspect = frame ? frame.width / frame.height : 16 / 9;

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-hairline bg-black"
      style={{ aspectRatio: aspect }}
    >
      {frame && (
        // A data URL from the debug socket, not a static asset next/image can optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame.src} alt="" className="absolute inset-0 size-full object-contain" />
      )}
      <ItemLabels detections={detections} />
      <FaceLabels faces={faces} />
      {status !== "connected" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-sm text-white">
          {STATUS_TEXT[status]}
        </div>
      )}
    </div>
  );
}
