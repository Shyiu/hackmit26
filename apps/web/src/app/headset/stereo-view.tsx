"use client";

import type { CSSProperties } from "react";
import type { Detection } from "@memory-glasses/shared";
import { Hud, ItemLabels, StallCard } from "@/components/wearer/hud";
import { LiveVideo } from "@/components/wearer/live-video";
import type { HudMessage } from "@/hooks/use-hud-message";
import { cn } from "@/lib/utils";

type StereoViewProps = {
  stream: MediaStream | null;
  onVideoElement: (element: HTMLVideoElement | null) => void;
  aspect: number;
  viewportHeight: number;
  eyeSpacing: number;
  zoom: number;
  textScale: number;
  labels: Detection[];
  message: HudMessage | null;
  messageVisible: boolean;
  listening: boolean;
  recording: boolean;
  stalled: boolean;
};

// The camera feed drawn once per eye, both copies from the same MediaStream. Each
// copy is centered under its lens, `eyeSpacing` apart, and clipped to its half of
// the screen. Everything drawn on top sits at the same spot in both eyes, so the
// wearer fuses it into one image.
export function StereoView(props: StereoViewProps) {
  return (
    <>
      <Eye side="left" {...props} />
      <Eye side="right" {...props} onVideoElement={undefined} />
    </>
  );
}

function Eye({
  side,
  stream,
  onVideoElement,
  aspect,
  viewportHeight,
  eyeSpacing,
  zoom,
  textScale,
  labels,
  message,
  messageVisible,
  listening,
  recording,
  stalled,
}: Omit<StereoViewProps, "onVideoElement"> & {
  side: "left" | "right";
  onVideoElement?: (element: HTMLVideoElement | null) => void;
}) {
  // This eye's lens center, measured from the left edge of its half of the screen.
  const centerX = side === "left" ? `calc(100% - ${eyeSpacing / 2}px)` : `${eyeSpacing / 2}px`;
  const frame: CSSProperties = {
    left: centerX,
    height: viewportHeight,
    width: viewportHeight * aspect,
    transform: `translate(-50%, -50%) scale(${zoom})`,
  };
  const overlayWidth = eyeSpacing * 0.8;

  return (
    <div className={cn("absolute inset-y-0 w-1/2 overflow-hidden", side === "left" ? "left-0" : "right-0")}>
      <div className="absolute top-1/2" style={frame}>
        <LiveVideo stream={stream} onElement={onVideoElement} className="size-full object-cover" />
        <ItemLabels detections={labels} />
      </div>
      <Hud
        message={message}
        messageVisible={messageVisible}
        listening={listening}
        recording={recording}
        scale={textScale}
        style={{ left: centerX, width: overlayWidth, transform: "translateX(-50%)" }}
      />
      {stalled && (
        <StallCard textStyle={{ left: centerX, width: overlayWidth, transform: "translate(-50%, -50%)" }} />
      )}
    </div>
  );
}
