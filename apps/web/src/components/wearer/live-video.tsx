"use client";

import { useCallback, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

// A muted inline <video> showing a live MediaStream. No JavaScript touches the
// frames, so passthrough delay is only what the browser's compositor adds.
export function LiveVideo({
  stream,
  onElement,
  className,
  style,
}: {
  stream: MediaStream | null;
  onElement?: (element: HTMLVideoElement | null) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      onElement?.(element);
      if (!element || element.srcObject === stream) return;
      element.srcObject = stream;
      if (stream) element.play().catch(() => {});
    },
    [stream, onElement]
  );

  return (
    <video
      ref={attach}
      autoPlay
      muted
      playsInline
      disablePictureInPicture
      className={cn("pointer-events-none", className)}
      style={style}
    />
  );
}
