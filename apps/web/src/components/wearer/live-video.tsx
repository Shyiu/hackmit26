"use client";

import { useCallback, type CSSProperties } from "react";
import { isSidewaysRotation } from "@/lib/client/camera-rotation";
import { cn } from "@/lib/utils";

// A muted <video> showing a live MediaStream. No JavaScript touches the
// frames, so passthrough delay is only what the browser's compositor adds --
// unless `rotateDeg` is set, in which case `className`/`style` size a wrapper
// div instead of the video itself, and the video is sized in container query
// units (cqw/cqh) to the wrapper's swapped cross dimensions, then rotated
// about its own center. That swap is exactly what undoes the rotation: since
// the caller sizes the wrapper to the already-rotated aspect ratio (see
// rotatedAspect), the pre-rotation video box ends up with the camera's own
// natural aspect ratio, so nothing is cropped or stretched.
export function LiveVideo({
  stream,
  onElement,
  className,
  style,
  rotateDeg = 0,
}: {
  stream: MediaStream | null;
  onElement?: (element: HTMLVideoElement | null) => void;
  className?: string;
  style?: CSSProperties;
  rotateDeg?: number;
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

  if (!rotateDeg) {
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

  const sideways = isSidewaysRotation(rotateDeg);
  return (
    <div className={cn("pointer-events-none relative overflow-hidden", className)} style={{ ...style, containerType: "size" }}>
      <video
        ref={attach}
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: sideways ? "100cqh" : "100cqw",
          height: sideways ? "100cqw" : "100cqh",
          objectFit: "cover",
          transform: `translate(-50%, -50%) rotate(${rotateDeg}deg)`,
        }}
      />
    </div>
  );
}
