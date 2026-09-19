import { useCallback, useEffect, useRef, useState } from "react";

export type HudMessageKind = "caption" | "notice";

export type HudMessage = { kind: HudMessageKind; text: string };

const WORDS_PER_SECOND = 2.5;

// Long enough to read the text twice at an unhurried 150 words a minute, and
// never under four seconds.
export function holdTimeMs(text: string) {
  const words = text.trim().split(/\s+/).length;
  return Math.max(4000, 1000 + ((2 * words) / WORDS_PER_SECOND) * 1000);
}

// The HUD's single message slot. A caption replaces whatever is showing. A notice
// never interrupts a caption and is dropped instead. Anything stored server-side,
// like a caregiver message, stays queued for the next poll.
export function useHudMessage() {
  const [message, setMessage] = useState<HudMessage | null>(null);
  const [visible, setVisible] = useState(false);
  const currentRef = useRef<HudMessage | null>(null);
  const timerRef = useRef<number | null>(null);

  const show = useCallback((kind: HudMessageKind, text: string) => {
    if (kind === "notice" && currentRef.current?.kind === "caption") return false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const next = { kind, text };
    currentRef.current = next;
    setMessage(next);
    setVisible(true);
    timerRef.current = window.setTimeout(() => {
      currentRef.current = null;
      setVisible(false);
    }, holdTimeMs(text));
    return true;
  }, []);

  useEffect(() => {
    const timer = timerRef;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  // `message` outlives `visible`, so the text can fade out instead of vanishing.
  return { message, visible, show };
}
