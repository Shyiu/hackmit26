import { useEffect, useState, useSyncExternalStore } from "react";

function subscribeNothing() {
  return () => {};
}

// Keeps the screen on while `enabled`. The browser drops the lock whenever the
// page is hidden, so it's taken again when the page comes back.
export function useWakeLock(enabled: boolean) {
  const [held, setHeld] = useState(false);
  const supported = useSyncExternalStore(
    subscribeNothing,
    () => "wakeLock" in navigator,
    () => false
  );

  useEffect(() => {
    if (!enabled || !supported) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
          return;
        }
        sentinel = lock;
        setHeld(true);
        lock.addEventListener("release", () => setHeld(false));
      } catch {
        setHeld(false);
      }
    }

    function onVisibilityChange() {
      void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
    };
  }, [enabled, supported]);

  return { held: enabled && held, supported };
}

export type DisplayMode = "fullscreen" | "home screen app" | "browser";

function subscribeDisplayMode(onChange: () => void) {
  const queries = ["(display-mode: standalone)", "(display-mode: fullscreen)"].map((query) =>
    window.matchMedia(query)
  );
  document.addEventListener("fullscreenchange", onChange);
  queries.forEach((query) => query.addEventListener("change", onChange));
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    queries.forEach((query) => query.removeEventListener("change", onChange));
  };
}

function getDisplayMode(): DisplayMode {
  if (document.fullscreenElement) return "fullscreen";
  const homeScreenApp =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return homeScreenApp ? "home screen app" : "browser";
}

// Whether the browser chrome is out of the way: element fullscreen on Android,
// or a web app launched from the home screen on iPhone.
export function useDisplayMode() {
  return useSyncExternalStore(subscribeDisplayMode, getDisplayMode, (): DisplayMode => "browser");
}

// Element fullscreen where the browser allows it, to hide Android's browser
// chrome. iPhone Safari has none, so there the page runs as a home screen web
// app. No orientation lock: the chest clamp may hold the phone either way. Call
// this from a tap handler before any await, or the browser refuses.
export async function enterFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // Refused or unsupported. The page still works with the browser chrome showing.
  }
}
