"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type CaptureState = "live" | "paused" | "offline";
type CaptureResponse = { capture: { state: CaptureState } | null };

const LABELS: Record<CaptureState | "unknown", string> = {
  live: "Camera live",
  paused: "Camera paused",
  offline: "Camera offline",
  unknown: "Camera offline",
};

const DOTS: Record<CaptureState | "unknown", string> = {
  live: "bg-emerald-500 animate-pulse",
  paused: "bg-amber-500",
  offline: "bg-muted-foreground/50",
  unknown: "bg-muted-foreground/50",
};

// Whether the chest camera is streaming, from the newest capture session. Polls
// every few seconds while the tab is visible.
export function CaptureBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [state, setState] = useState<CaptureState | "unknown">("unknown");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/capture");
        if (!response.ok) return;
        const body = (await response.json()) as CaptureResponse;
        if (!cancelled) setState(body.capture?.state ?? "unknown");
      } catch {
        // Offline for a moment; keep the last state.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[0.5rem] border-2 border-brand/25 bg-brand-soft/40 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-brand-deep",
        className,
      )}
    >
      <span className={cn("size-2 rounded-full", DOTS[state])} />
      {compact ? LABELS[state].replace("Camera ", "") : LABELS[state]}
    </span>
  );
}
