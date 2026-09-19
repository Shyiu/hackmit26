import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const DEFAULT_ASPECT = 16 / 9;

// Width over height of what the camera actually sends. Phones swap the two when
// they rotate, so this follows the video's resize events.
export function useVideoAspect(video: HTMLVideoElement | null) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!video) return () => {};
      video.addEventListener("loadedmetadata", onChange);
      video.addEventListener("resize", onChange);
      return () => {
        video.removeEventListener("loadedmetadata", onChange);
        video.removeEventListener("resize", onChange);
      };
    },
    [video]
  );
  return useSyncExternalStore(
    subscribe,
    () => (video && video.videoWidth > 0 ? video.videoWidth / video.videoHeight : DEFAULT_ASPECT),
    () => DEFAULT_ASPECT
  );
}

// True once `video` goes `timeoutMs` without presenting a new frame. On the
// chest nobody is watching the screen, so the page plays a tone instead.
export function useFeedWatchdog(video: HTMLVideoElement | null, active: boolean, timeoutMs = 1000) {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!video || !active) return;
    const element = video;
    const watchesFrames = typeof element.requestVideoFrameCallback === "function";
    let lastFrameAt = performance.now();
    let lastTime = element.currentTime;
    let handle: number | null = null;

    function onFrame() {
      lastFrameAt = performance.now();
      handle = element.requestVideoFrameCallback(onFrame);
    }

    // Hidden pages present no frames. Don't count that time against the feed.
    function onVisibilityChange() {
      lastFrameAt = performance.now();
    }

    if (watchesFrames) handle = element.requestVideoFrameCallback(onFrame);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(() => {
      if (!watchesFrames && element.currentTime !== lastTime) {
        lastTime = element.currentTime;
        lastFrameAt = performance.now();
      }
      setStalled(performance.now() - lastFrameAt > timeoutMs);
    }, 250);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (handle !== null) element.cancelVideoFrameCallback(handle);
    };
  }, [video, active, timeoutMs]);

  return active && stalled;
}
