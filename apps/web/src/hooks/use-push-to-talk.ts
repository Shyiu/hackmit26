import { useCallback, useEffect, useRef, useState } from "react";

type AudioSessionType =
  | "auto"
  | "playback"
  | "transient"
  | "transient-solo"
  | "ambient"
  | "play-and-record";

// Safari 17 and later let a page name its audio session instead of having WebKit
// guess from the media calls it makes. Other browsers don't have it.
function setAudioSession(type: AudioSessionType) {
  const session = (navigator as Navigator & { audioSession?: { type: AudioSessionType } })
    .audioSession;
  if (session) session.type = type;
}

// The longest a question stays open. A clicker toggle has no key-up to end it.
const MAX_LISTEN_MS = 15_000;

export type TurnOutcome = "released" | "mic-blocked";

// Opens the mic only while the wearer is asking and stops its tracks right after.
// On iPhone, an open mic pulls answer audio into the earpiece at low volume.
// Speech to text isn't wired up yet, so a turn opens and closes the mic and
// reports how it ended.
export function usePushToTalk({ onTurnEnd }: { onTurnEnd: (outcome: TurnOutcome) => void }) {
  const [listening, setListening] = useState(false);
  const [micAllowed, setMicAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const openRef = useRef(false);
  const turnRef = useRef(0);
  const onTurnEndRef = useRef(onTurnEnd);

  useEffect(() => {
    onTurnEndRef.current = onTurnEnd;
  });

  const closeMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setAudioSession("auto");
  }, []);

  const release = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    turnRef.current++;
    closeMic();
    setListening(false);
    onTurnEndRef.current("released");
  }, [closeMic]);

  const press = useCallback(async () => {
    if (openRef.current || !navigator.mediaDevices?.getUserMedia) return;
    openRef.current = true;
    const turn = ++turnRef.current;
    setAudioSession("play-and-record");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (turn !== turnRef.current) {
        // Released while the mic was still opening.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setMicAllowed(true);
      setError(null);
      setListening(true);
      timerRef.current = window.setTimeout(release, MAX_LISTEN_MS);
    } catch {
      if (turn !== turnRef.current) return;
      openRef.current = false;
      setAudioSession("auto");
      setError("Microphone permission was denied.");
      onTurnEndRef.current("mic-blocked");
    }
  }, [release]);

  // Ask for mic permission up front, so the first question doesn't stop at a
  // permission prompt, then close the mic again.
  const prime = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((track) => track.stop());
      setMicAllowed(true);
      setError(null);
      return true;
    } catch {
      setError("Microphone permission was denied.");
      return false;
    }
  }, []);

  useEffect(() => closeMic, [closeMic]);

  return { listening, micAllowed, error, press, release, prime };
}
