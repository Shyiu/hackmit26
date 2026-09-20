"use client";

import type { ScanPin } from "@memory-glasses/shared";
import { Home, MapPin, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { ViewerHandle } from "./types";

type PlaceItem = { id: string; name: string };

// Dark chips over the viewport. The dashboard's own buttons are built for a white panel.
const control =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-2.5 text-xs font-medium text-white/80 transition-colors hover:bg-black/85 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none disabled:opacity-50 pointer-coarse:h-10 pointer-coarse:px-3.5";

/** "seen 4 min ago", short enough to ride on an arrow. */
function seenAgo(iso: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "seen just now";
  if (minutes < 60) return `seen ${minutes} min ago`;
  if (minutes < 60 * 24) return `seen ${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / (60 * 24));
  return `seen ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The highlight colour of the app, as something three.js can parse. */
function accentColor(element: HTMLElement) {
  const style = getComputedStyle(element);
  for (const name of ["--butter", "--brand"]) {
    const value = style.getPropertyValue(name).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|hsl)\(/i.test(value)) return value;
  }
  return "#f7d774";
}

/**
 * The 3D room with an arrow on each item's last known spot. "static" is the bundled demo room
 * (mesh, with its splat one toggle away); "live" is the wearer's growing splat-slam scene.
 */
export function ScanViewer({
  mode,
  focusItemId,
  compact = false,
  className,
}: {
  mode: "static" | "live";
  focusItemId?: string;
  compact?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>("Loading the 3D view…");
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string[]>([]);
  const [pins, setPins] = useState<ScanPin[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setView] = useState<"mesh" | "splat">("mesh");
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeItem, setPlaceItem] = useState<PlaceItem | null>(null);
  const [items, setItems] = useState<PlaceItem[] | null>(null);
  const [resetting, setResetting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const hostElement = host.current;
    const labelElement = labels.current;
    if (!hostElement || !labelElement) return;
    let cancelled = false;
    let handle: ViewerHandle | null = null;

    async function boot(hostElement: HTMLElement, labelElement: HTMLElement) {
      const { createEngine, loadLibs } = await import("./engine");
      const libs = await loadLibs();
      if (cancelled) return;
      let engine;
      try {
        engine = createEngine(libs, hostElement, labelElement, accentColor(hostElement));
      } catch {
        throw new Error("This browser cannot draw the 3D view.");
      }
      const events = {
        onPins: setPins,
        onMessage: setMessage,
        onStatus: setStatus,
        onFocus: setFocusId,
        onNotice: setNotice,
        onPlaced: () => {
          setPlaceItem(null);
          setPlaceOpen(false);
          viewer.current?.setPlacing(null);
        },
      };
      try {
        handle =
          mode === "static"
            ? await (await import("./static-scene")).createStaticViewer(engine, events, focusItemId)
            : await (await import("./live-scene")).createLiveViewer(engine, events, focusItemId);
      } catch (error) {
        engine.dispose();
        throw error;
      }
      if (cancelled) return handle.dispose();
      viewer.current = handle;
      setReady(true);
    }

    boot(hostElement, labelElement).catch((error: unknown) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : "The 3D view did not load.");
    });
    return () => {
      cancelled = true;
      viewer.current = null;
      handle?.dispose();
    };
  }, [mode, focusItemId]);

  // A notice clears itself.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function focus(itemId: string | null) {
    setFocusId(itemId);
    viewer.current?.setFocus(itemId);
  }

  function chooseView(next: "mesh" | "splat") {
    setView(next);
    viewer.current?.setView(next);
  }

  function togglePlace() {
    const open = !placeOpen;
    setPlaceOpen(open);
    if (!open) {
      setPlaceItem(null);
      viewer.current?.setPlacing(null);
      return;
    }
    if (items) return;
    apiFetch<{ items: { _id: string; name: string; active?: boolean }[] }>("/api/items")
      .then((body) => setItems(body.items.filter((item) => item.active !== false).map((item) => ({ id: item._id, name: item.name }))))
      .catch((error: unknown) => {
        setItems([]);
        setNotice(error instanceof Error ? error.message : "The items did not load.");
      });
  }

  function choosePlaceItem(item: PlaceItem) {
    setPlaceItem(item);
    viewer.current?.setPlacing(item);
  }

  async function newScan() {
    if (!window.confirm("Start a new scan? The viewer will switch to a fresh scene. The existing scan stays saved on the server.")) return;
    setResetting(true);
    try {
      await viewer.current?.resetScan();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The new scan did not start.");
    } finally {
      setResetting(false);
    }
  }

  const drawn = pins.filter((pin) => pin.position || pin.observation);

  return (
    <div className={cn("relative isolate min-h-48 overflow-hidden bg-[#0d0f14] text-white select-none", className)}>
      <div ref={host} className="absolute inset-0" />

      <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden">
        {ready &&
          drawn.map((pin) => (
            <button
              key={pin.itemId}
              type="button"
              data-pin={pin.itemId}
              onClick={() => focus(focusId === pin.itemId ? null : pin.itemId)}
              style={{ visibility: "hidden" }}
              className={cn(
                "pointer-events-auto absolute top-0 left-0 flex flex-col items-center rounded-md border px-2 py-1 text-center leading-tight whitespace-nowrap transition-[opacity,background-color,border-color] will-change-transform",
                focusId === pin.itemId
                  ? "z-10 border-butter/70 bg-black/85 text-white"
                  : "border-white/10 bg-black/70 text-white/85 hover:bg-black/85",
                focusId !== null && focusId !== pin.itemId && "opacity-55",
              )}
            >
              <span className={cn("font-medium", compact ? "text-[0.6875rem]" : "text-xs")}>{pin.itemName}</span>
              <span className="text-[0.6875rem] text-white/60">
                {pin.position ? seenAgo(pin.seenAt, now) : "locating…"}
              </span>
            </button>
          ))}
      </div>

      {message && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">
          {message}
        </p>
      )}

      {ready && (
        <div className="absolute top-2 right-2 left-2 flex items-start justify-between gap-2">
          {mode === "static" ? (
            <div role="group" aria-label="View" className="flex rounded-md border border-white/10 bg-black/70 p-0.5">
              {(["mesh", "splat"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => chooseView(option)}
                  className={cn(
                    "h-7 rounded-[0.3rem] px-2.5 text-xs font-medium capitalize transition-colors pointer-coarse:h-9 pointer-coarse:px-3.5",
                    view === option ? "bg-white/15 text-white" : "text-white/60 hover:text-white",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              {mode === "static" && !compact && (
                <button type="button" aria-expanded={placeOpen} onClick={togglePlace} className={control}>
                  {placeOpen ? <X className="size-3.5" /> : <MapPin className="size-3.5" />}
                  {placeOpen ? "Done" : "Place item"}
                </button>
              )}
              {mode === "live" && !compact && (
                <button type="button" onClick={newScan} disabled={resetting} className={control}>
                  <RotateCcw className="size-3.5" />
                  New scan
                </button>
              )}
              <button type="button" aria-label="Reset the view" onClick={() => viewer.current?.home()} className={cn(control, "px-2")}>
                <Home className="size-3.5" />
              </button>
            </div>
            {placeOpen && (
              <div className="max-h-56 w-48 overflow-y-auto rounded-md border border-white/10 bg-black/80 p-1 text-xs">
                {items === null && <p className="px-2 py-1.5 text-white/60">Loading items…</p>}
                {items?.length === 0 && <p className="px-2 py-1.5 text-white/60">No items yet.</p>}
                {items?.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={placeItem?.id === item.id}
                    onClick={() => choosePlaceItem(item)}
                    className={cn(
                      "block w-full truncate rounded-[0.3rem] px-2 py-1.5 text-left transition-colors pointer-coarse:py-2.5",
                      placeItem?.id === item.id ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10",
                    )}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex flex-col items-start gap-1 text-xs">
        {notice && <p className="rounded-md border border-white/10 bg-black/80 px-2 py-1 text-white/85">{notice}</p>}
        {placeItem && (
          <p className="rounded-md border border-white/10 bg-black/80 px-2 py-1 text-white/85">
            Tap the spot where {placeItem.name} was last seen.
          </p>
        )}
        {mode === "live" && status.length > 0 && (
          <p className="rounded-md border border-white/10 bg-black/70 px-2 py-1 font-mono text-[0.6875rem] text-white/65">
            {status.join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
