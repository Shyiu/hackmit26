"use client";

import type { Detection } from "@memory-glasses/shared";
import type { ItemStatus } from "@/hooks/use-item-statuses";
import { cn } from "@/lib/utils";

// How long a sighting's lastSeenAt can lag behind the last poll and still
// count as the live, currently-confirmed track behind this frame's box:
// longer than the tracker's 500ms refresh interval and the panel's 1500ms
// poll, so a still-tracked item doesn't flicker between states between polls.
const ACTIVE_WINDOW_MS = 2500;

type DetectionState = "watching" | "pending" | "ready" | "failed";

const STATE_STYLES: Record<DetectionState, { box: string; text: string; label: string }> = {
  // Detector saw it this frame, but the tracker hasn't confirmed it yet (needs
  // 3 hits within 2s) — nothing has been queued for the vision model.
  watching: { box: "border-slate-400", text: "text-slate-200", label: "detected, not confirmed" },
  pending: { box: "border-amber-400", text: "text-amber-300", label: "confirmed — vision model describing" },
  ready: { box: "border-emerald-400", text: "text-emerald-300", label: "described by vision model" },
  failed: { box: "border-red-400", text: "text-red-300", label: "vision model failed" },
};

function detectionState(item: ItemStatus | undefined, fetchedAt: number): DetectionState {
  if (!item?.lastSighting) return "watching";
  const age = fetchedAt - new Date(item.lastSighting.lastSeenAt).getTime();
  if (age > ACTIVE_WINDOW_MS) return "watching";
  if (item.lastSighting.descriptionStatus === "ready") return "ready";
  if (item.lastSighting.descriptionStatus === "failed") return "failed";
  return "pending";
}

/**
 * Boxes and labels for every raw detector box this frame, colored by what the
 * write-time pipeline has actually done with the track behind it: gray means
 * the detector sees it but the tracker hasn't confirmed a sighting yet, so the
 * vision model was never called; amber/green/red mean a sighting was
 * confirmed and the vision model is running, finished, or failed on it.
 */
export function DetectionOverlay({
  detections,
  items,
  fetchedAt,
}: {
  detections: Detection[];
  items: ItemStatus[] | null;
  fetchedAt: number;
}) {
  const byId = new Map((items ?? []).map((item) => [item._id, item]));
  return (
    <div className="pointer-events-none absolute inset-0">
      {detections.map((detection, index) => {
        const [x, y, w, h] = detection.bbox;
        const state = detectionState(byId.get(detection.itemId), fetchedAt);
        const style = STATE_STYLES[state];
        return (
          <div
            // The wire message carries only itemId, not a per-box instance id, so a
            // low DETECTOR_CONFIDENCE can legitimately return two overlapping raw
            // boxes for the same item in one frame; index keeps them from colliding.
            key={`${detection.itemId}-${index}`}
            className={cn("absolute rounded-lg border-2", style.box)}
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          >
            <span
              className={cn(
                "absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-md bg-black/75 px-2 py-0.5 text-sm font-medium whitespace-nowrap",
                style.text,
              )}
            >
              {detection.label} · {Math.round(detection.confidence * 100)}% · {style.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Key for DetectionOverlay's colors, so the states are legible without reading the code. */
export function DetectionLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {(Object.entries(STATE_STYLES) as [DetectionState, (typeof STATE_STYLES)[DetectionState]][]).map(
        ([key, style]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full border-2", style.box)} />
            {style.label}
          </span>
        ),
      )}
    </div>
  );
}
