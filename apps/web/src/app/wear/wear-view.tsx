"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Camera, Mic, Pause, Play, ScanEye, Settings2 } from "lucide-react";
import { ItemLabels, StallCard } from "@/components/wearer/hud";
import { LiveVideo } from "@/components/wearer/live-video";
import { NoticeStack } from "@/components/wearer/notice-stack";
import { useStoredNumber } from "@/hooks/use-stored-setting";
import { useVideoAspect } from "@/hooks/use-video-frames";
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
  const { hud, voice, live, capturing, answer, stalled, recorder, camera, perception } = client;
  const aspect = useVideoAspect(client.video);

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
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{ aspectRatio: aspect, width: `min(100%, calc(100dvh * ${aspect}))` }}
          >
            <LiveVideo stream={camera.stream} onElement={client.setVideo} className="h-full w-full opacity-60" />
            <ItemLabels detections={perception.detections} />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/70" />
          </div>
        </div>
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
            {camera.lens !== "unknown" && (
              <StatusChip tone="neutral">
                <Camera className="size-4" />
                {camera.lens === "ultrawide" ? "0.5×" : "1×"}
              </StatusChip>
            )}
            {perception.status === "connected" && (
              <StatusChip tone="neutral">
                <ScanEye className="size-4" />
                Seeing
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

        <footer className="flex items-end justify-end gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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

      <NoticeStack
        notices={client.notices}
        onDismiss={client.dismissNotice}
        className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] z-20 mx-auto max-w-md"
      />
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
