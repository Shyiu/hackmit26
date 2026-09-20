"use client";

import { useEffect, useRef } from "react";
import { playAlertTone } from "@/lib/tones";

const SEEN_KEY = "mg_alerts_heard";

function readSeen(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-100)));
  } catch {
    // Storage full or blocked: the worst case is one repeated tone.
  }
}

// Plays the alert tone once per alert id that appears while the page is open,
// for caregivers who turned sound on. Ids already on screen when the tab opened
// are remembered for the tab's lifetime, so a refresh or a trip to another page
// stays quiet. Browsers only let audio start after a tap, so the context is
// resumed on the first pointer or key event.
export function NotificationSound({ alertIds }: { alertIds: string[] }) {
  const audioRef = useRef<AudioContext | null>(null);
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const resume = () => {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
    };
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const freshTab = seenRef.current === null && window.sessionStorage.getItem(SEEN_KEY) === null;
    const seen = (seenRef.current ??= readSeen());
    const fresh = alertIds.filter((id) => !seen.has(id));
    if (fresh.length === 0 && !freshTab) return;
    for (const id of fresh) seen.add(id);
    writeSeen(seen);
    if (fresh.length > 0 && !freshTab && audioRef.current?.state === "running") playAlertTone(audioRef.current);
  }, [alertIds]);

  return null;
}
