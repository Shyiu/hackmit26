"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

// The viewer needs WebGL, so it loads in the browser only. This wrapper is the
// client boundary that lets the dashboard pages stay server components.
const ScanViewer = dynamic(() => import("@/components/scan/scan-viewer").then((module) => module.ScanViewer), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center text-xs text-muted-foreground">Loading the 3D view…</div>
  ),
});

// A sized frame around the viewer. The caller sets the height or aspect through
// `className`; the viewer fills it.
export function ScanPanel({
  mode,
  focusItemId,
  compact,
  className,
}: {
  mode: "static" | "live";
  focusItemId?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-lg border border-hairline bg-muted/40", className)}>
      {/* Keyed by mode so switching scenes starts from a clean viewer. */}
      <ScanViewer key={mode} mode={mode} focusItemId={focusItemId} compact={compact} className="size-full" />
    </div>
  );
}
