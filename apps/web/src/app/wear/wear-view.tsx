"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Mic, Pause, Play, Settings2 } from "lucide-react";
import { StallCard } from "@/components/wearer/hud";
import { LiveVideo } from "@/components/wearer/live-video";
import { useStoredNumber } from "@/hooks/use-stored-setting";
import { useWearerClient } from "@/hooks/use-wearer-client";
import { cn } from "@/lib/utils";
import { SetupPanel } from "./setup-panel";

// A Bluetooth clicker or keyboard asks the same way a tap does. Presentation
// clickers send arrows or page keys; camera shutter remotes send volume-up,
// which a page never sees.
const ASK_KEYS = new Set([" ", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);

export function WearView() {
  const client = useWearerClient({ turnMode: "auto", fullscreen: true });
  const [panelOpen, setPanelOpen] = useState(true);
  const [textScale, setTextScale] = useStoredNumber("wear.textScale", 1);
  const { hud, voice, live, capturing, answer, stalled, recorder } = client;

  function handleTap() {
    if (!live || panelOpen) return;
    client.toggleTurn();
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.repeat || panelOpen || !live || !ASK_KEYS.has(event.key)) return;
    if (event.target instanceof Element && event.target.closest("input, select, textarea, button")) return;
    event.preventDefault();
    client.toggleTurn();
  });

  useEffect(() => {
    const handle = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const showMessage = hud.visible && hud.message !== null;

  return (
    <div className="dark fixed inset-0 overflow-hidden bg-black text-white select-none">
      <div
        className="absolute inset-0 flex touch-none flex-col [-webkit-touch-callout:none]"
        onPointerDown={handleTap}
      >
        <header className="flex items-start justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex flex-wrap gap-2 text-sm font-medium">
            <StatusChip tone={capturing ? "live" : "paused"}>
              {capturing ? "Capturing" : "Paused"}
            </StatusChip>
            {recorder.recording && <StatusChip tone="recording">Recording</StatusChip>}
            {voice.listening && (
              <StatusChip tone="neutral">
                <Mic className="size-4" />
                Listening
              </StatusChip>
            )}
          </div>
          <button
            type="button"
            aria-label="Setup"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPanelOpen(true)}
          >
            <Settings2 className="size-6" />
          </button>
        </header>

        <main
          className="flex flex-1 items-center justify-center px-6 text-center"
          style={{ fontSize: `${textScale}rem` }}
          aria-live="polite"
        >
          {voice.listening ? (
            <div className="flex max-w-3xl flex-col items-center gap-4">
              <span className="flex size-16 items-center justify-center rounded-full bg-white/10">
                <Mic className="size-8 animate-pulse" />
              </span>
              <p className="text-[2em] leading-snug font-medium text-white/80">
                {voice.interim || "Listening…"}
              </p>
            </div>
          ) : answer === "thinking" ? (
            <p className="animate-pulse text-[2.5em] text-white/60">…</p>
          ) : (
            <p
              className={cn(
                "max-w-3xl text-[2.25em] leading-snug font-semibold text-balance transition-opacity duration-700",
                showMessage ? "opacity-100" : "opacity-0",
              )}
            >
              {hud.message?.text}
            </p>
          )}
          {!voice.listening && answer === "idle" && !showMessage && live && (
            <p className="absolute text-[1.1em] text-white/25">Tap anywhere to ask</p>
          )}
        </main>

        <footer className="flex items-end justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="w-28 overflow-hidden rounded-lg bg-white/5 opacity-60 sm:w-36">
            <LiveVideo stream={client.camera.stream} onElement={client.setVideo} className="aspect-video w-full object-cover" />
          </div>
          <button
            type="button"
            disabled={!live}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={capturing ? client.pause : client.resume}
            className={cn(
              "flex h-14 items-center gap-2 rounded-full px-6 text-lg font-semibold disabled:opacity-40",
              capturing ? "bg-white/10 text-white" : "bg-emerald-500 text-black",
            )}
          >
            {capturing ? <Pause className="size-5" /> : <Play className="size-5" />}
            {capturing ? "Pause" : "Resume"}
          </button>
        </footer>
      </div>

      {stalled && <StallCard />}

      {panelOpen && (
        <SetupPanel
          client={client}
          textScale={textScale}
          onTextScaleChange={setTextScale}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: "live" | "paused" | "recording" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
      {tone !== "neutral" && (
        <span
          className={cn(
            "size-2.5 rounded-full",
            tone === "live" && "animate-pulse bg-emerald-400",
            tone === "paused" && "bg-amber-400",
            tone === "recording" && "bg-red-500",
          )}
        />
      )}
      {children}
    </span>
  );
}
