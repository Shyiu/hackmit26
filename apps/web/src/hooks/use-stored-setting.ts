import { useCallback, useSyncExternalStore } from "react";

// Per-device settings such as eye spacing, zoom, and the chosen camera, kept in
// localStorage. The server render sees null, and the client picks up the stored
// value right after hydration.
const CHANGE_EVENT = "stored-setting-change";

// Used when localStorage is blocked, so a setting still holds until reload.
const memory = new Map<string, string>();

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function readStoredString(key: string) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeStoredString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useStoredString(key: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => readStoredString(key),
    () => null
  );
  const setValue = useCallback((next: string) => writeStoredString(key, next), [key]);
  return [value, setValue] as const;
}

export function useStoredNumber(key: string, initial: number) {
  const [raw, setRaw] = useStoredString(key);
  const parsed = raw === null ? Number.NaN : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : initial;
  const setValue = useCallback((next: number) => setRaw(String(next)), [setRaw]);
  return [value, setValue] as const;
}
