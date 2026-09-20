"use client";

import type { ScanLiveState, ScanPin } from "@memory-glasses/shared";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const loadingNote = (
  <div className="flex size-full items-center justify-center text-xs text-muted-foreground">Loading the 3D view…</div>
);

// The viewer needs WebGL, so it loads in the browser only. This wrapper is the
// client boundary that lets the dashboard pages stay server components.
const ScanViewer = dynamic(() => import("@/components/scan/scan-viewer").then((module) => module.ScanViewer), {
  ssr: false,
  loading: () => loadingNote,
});

/**
 * Which scene shows this item: the live scan when the item has a solved pin in the scene that is
 * running now, else the bundled room. A pin left in an earlier, reset live scene doesn't count, and the
 * server can't tell without asking splat-slam on every render of a page that refreshes itself.
 */
function useItemScene(itemId: string | undefined, enabled: boolean): "static" | "live" | null {
  const [scene, setScene] = useState<"static" | "live" | null>(null);
  useEffect(() => {
    if (!enabled || !itemId) return;
    let stale = false;
    const json = <T,>(url: string) => fetch(url).then((response) => (response.ok ? (response.json() as Promise<T>) : null));
    Promise.all([
      json<ScanLiveState>("/api/scan/live"),
      json<{ pins: ScanPin[] }>(`/api/scan/pins?itemId=${encodeURIComponent(itemId)}`),
    ])
      .then(([live, found]) => {
        const here = live?.sceneId && found?.pins.some((pin) => pin.sceneId === live.sceneId && pin.position);
        if (!stale) setScene(here ? "live" : "static");
      })
      .catch(() => {
        if (!stale) setScene("static");
      });
    return () => {
      stale = true;
    };
  }, [itemId, enabled]);
  return scene;
}

// A sized frame around the viewer. The caller sets the height or aspect through
// `className`; the viewer fills it.
export function ScanPanel({
  mode,
  focusItemId,
  compact,
  className,
}: {
  /** "auto" picks the scene that has a pin for `focusItemId`. */
  mode: "static" | "live" | "auto";
  focusItemId?: string;
  compact?: boolean;
  className?: string;
}) {
  const found = useItemScene(focusItemId, mode === "auto");
  const scene = mode === "auto" ? (focusItemId ? found : "static") : mode;
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-lg border border-hairline bg-muted/40", className)}>
      {/* Keyed by scene so switching starts from a clean viewer. */}
      {scene ? (
        <ScanViewer key={scene} mode={scene} focusItemId={focusItemId} compact={compact} className="size-full" />
      ) : (
        loadingNote
      )}
    </div>
  );
}
