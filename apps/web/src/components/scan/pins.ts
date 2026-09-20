import type { PutScanPinBody, ScanPin } from "@memory-glasses/shared";
import { apiFetch } from "@/lib/client/api";

/** Polls one scene's pins. `sceneId` is read on every tick, so a live scene can change under it. */
export function createPinFeed(sceneId: () => string | null, intervalMs: number, onPins: (pins: ScanPin[]) => void) {
  let stopped = false;
  let timer: number | undefined;
  let round = 0;

  async function tick() {
    window.clearTimeout(timer);
    const mine = ++round;
    const id = sceneId();
    try {
      if (id) {
        const { pins } = await apiFetch<{ pins: ScanPin[] }>(`/api/scan/pins?sceneId=${encodeURIComponent(id)}`);
        // A slow answer for an older scene or an older round is dropped.
        if (!stopped && mine === round && id === sceneId()) onPins(pins);
      }
    } catch {
      // The next round tries again; the arrows already drawn stay.
    }
    if (!stopped && mine === round) timer = window.setTimeout(tick, intervalMs);
  }
  void tick();

  return {
    refresh: () => void tick(),
    stop() {
      stopped = true;
      window.clearTimeout(timer);
    },
  };
}

export function putPin(body: PutScanPinBody) {
  return apiFetch<{ pin: ScanPin }>("/api/scan/pins", { method: "PUT", json: body });
}

/** `pins` with `pin` swapped in for the same item, or added. */
export function withPin(pins: ScanPin[], pin: ScanPin) {
  return [...pins.filter((other) => other.itemId !== pin.itemId), pin];
}
