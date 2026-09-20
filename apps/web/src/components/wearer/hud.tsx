import type { CSSProperties } from "react";
import { Bell, Mic } from "lucide-react";
import type { Detection, Face } from "@memory-glasses/shared";
import type { HudMessage } from "@/hooks/use-hud-message";
import { cn } from "@/lib/utils";

type HudProps = {
  message: HudMessage | null;
  messageVisible: boolean;
  listening: boolean;
  recording: boolean;
  scale?: number;
  className?: string;
  style?: CSSProperties;
};

// Status marks near the top, one message in the lower middle, drawn over the
// simulator's video. See README "What the screens show".
export function Hud({
  message,
  messageVisible,
  listening,
  recording,
  scale = 1,
  className,
  style,
}: HudProps) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-y-0 text-white", className)}
      style={{ fontSize: `${scale}rem`, ...style }}
    >
      <div className="absolute inset-x-0 top-[10%] flex justify-center gap-2 text-[0.8em] font-medium">
        {recording && (
          <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1">
            <span className="size-2.5 rounded-full bg-red-500" />
            Recording
          </span>
        )}
        {listening && (
          <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1">
            <Mic className="size-[1.1em]" />
            Listening
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-[12%] flex justify-center">
        <p
          aria-live="polite"
          className={cn(
            "flex items-start gap-2 rounded-xl bg-black/75 px-4 py-3 text-center text-[1.35em] leading-snug font-medium transition-opacity duration-700",
            messageVisible && message ? "opacity-100" : "opacity-0"
          )}
        >
          {message?.kind === "notice" && <Bell className="mt-[0.2em] size-[0.9em] shrink-0" />}
          {message?.text}
        </p>
      </div>
    </div>
  );
}

// Boxes and names for tracked items. Boxes come normalized to the frame, so this
// layer has to cover the video frame exactly.
export function ItemLabels({ detections }: { detections: Detection[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {detections.map((detection) => {
        const [x, y, w, h] = detection.bbox;
        return (
          <div
            key={detection.itemId}
            className="absolute rounded-lg border-2 border-yellow-300"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          >
            <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-md bg-black/75 px-2 py-0.5 text-sm font-medium whitespace-nowrap text-yellow-300">
              {detection.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Boxes for faces the perception service saw this frame, named where it matched
// an enrolled person and confident enough (README "Faces, danger, and routines").
// Debug tool for /sim: shows the raw detector/match confidence pairs, not the
// wearer-facing wording.
export function FaceLabels({ faces }: { faces: Face[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {faces.map((face, index) => {
        const [x, y, w, h] = face.bbox;
        const matched = face.personId !== null;
        return (
          <div
            key={`${face.personId ?? "unknown"}-${index}`}
            className={cn("absolute rounded-lg border-2", matched ? "border-cyan-300" : "border-red-400")}
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          >
            <span
              className={cn(
                "absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-md bg-black/75 px-2 py-0.5 text-sm font-medium whitespace-nowrap",
                matched ? "text-cyan-300" : "text-red-400",
              )}
            >
              {matched ? face.name : "Unrecognized"}
              {" · det "}
              {face.confidence.toFixed(2)}
              {face.matchConfidence !== null && ` · match ${face.matchConfidence.toFixed(2)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Covers the view when the camera feed freezes, so a frozen picture never
// passes for the room.
export function StallCard({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0 flex items-center justify-center bg-black p-6", className)}>
      <p className="max-w-sm text-center text-2xl font-semibold text-white">
        The camera stopped. Check the phone.
      </p>
    </div>
  );
}
