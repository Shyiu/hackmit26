"use client";

import { useEffect, useState } from "react";

export type ItemStatus = {
  _id: string;
  name: string;
  active: boolean;
  locationStatus: "observed" | "held" | "moved" | "uncertain" | "unseen";
  lastSighting: { sentence: string | null; state: string; descriptionStatus: string; lastSeenAt: string } | null;
};

const POLL_MS = 1500;

/**
 * Polls /api/items so a caller can show live per-item sighting and description
 * state. `fetchedAt` is the poll's own clock read (inside the effect, not
 * render), so a caller can compare it to a lastSeenAt timestamp without
 * calling Date.now() itself during render.
 */
export function useItemStatuses() {
  const [items, setItems] = useState<ItemStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/items", { cache: "no-store" });
        if (cancelled) return;
        if (!response.ok) {
          setError(response.status === 401 ? "Sign in to see item status." : `Couldn't load items (${response.status}).`);
          return;
        }
        const body = (await response.json()) as { items: ItemStatus[] };
        if (cancelled) return;
        setError(null);
        setItems(body.items.filter((item) => item.active));
        setFetchedAt(Date.now());
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { items, error, fetchedAt };
}
