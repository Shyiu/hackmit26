"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useState, type FormEvent } from "react";
import { Mic } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraSelect } from "@/components/wearer/camera-select";
import { Hud, ItemLabels, StallCard } from "@/components/wearer/hud";
import { LiveVideo } from "@/components/wearer/live-video";
import { useVideoAspect } from "@/hooks/use-video-frames";
import { useWearerClient } from "@/hooks/use-wearer-client";
import { cn } from "@/lib/utils";
import { ItemStatusPanel } from "./item-status-panel";

// A capture-path view like /sim's (see CLAUDE.md: a client feature added to
// useWearerClient reaches every view that calls it, and each view calls the
// hook directly rather than wrapping another view). This one drops recording
// and trims the question box down to typed-only, and adds the status panel
// below so a dev can watch perception.detections and /api/items agree that an
// item was actually seen and logged, without needing to ask a question.
export function ItemSimView() {
  const client = useWearerClient({ turnMode: "hold" });
  const { camera, hud, voice, perception, live, capturing } = client;
  const aspect = useVideoAspect(client.video);
  const [question, setQuestion] = useState("");

  const startOnMount = useEffectEvent(() => void client.start());
  useEffect(() => startOnMount(), []);

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    client.askText(question);
    setQuestion("");
  }

  const status =
    camera.status === "error"
      ? `Camera unavailable: ${camera.error}`
      : !live
        ? "Asking for camera access…"
        : client.answer === "thinking"
          ? "Looking it up…"
          : "Hold an item in frame, or type a question below.";

  return (
    <div className="flex flex-col gap-6">
      {client.signedIn === false && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>Sign in first. Frame upload and answers use the caregiver session.</p>
          <Link href="/login?next=/item_sim" className={buttonVariants()}>
            Sign in
          </Link>
        </div>
      )}

      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: aspect }}>
        <LiveVideo stream={camera.stream} onElement={client.setVideo} className="absolute inset-0 size-full object-contain" />
        <ItemLabels detections={perception.detections} />
        <Hud
          className="inset-x-[6%] text-[0.85rem] sm:text-base"
          message={hud.message}
          messageVisible={hud.visible}
          listening={voice.listening}
          recording={false}
        />
        <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white">
          <span className={cn("size-2 rounded-full", capturing ? "animate-pulse bg-emerald-400" : "bg-amber-400")} />
          {capturing ? "Capturing" : "Paused"}
        </span>
        {client.stalled && <StallCard />}
      </div>

      <p className="min-h-6 text-sm text-muted-foreground" aria-live="polite">
        {status}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" variant={capturing ? "outline" : "default"} disabled={!live} onClick={capturing ? client.pause : client.resume}>
          {capturing ? "Pause capture" : "Resume capture"}
        </Button>
        <CameraSelect
          cameras={camera.cameras}
          activeDeviceId={camera.stream?.getVideoTracks()[0]?.getSettings().deviceId}
          onChange={client.changeCamera}
        />
      </div>

      <form onSubmit={submitQuestion} className="flex gap-2">
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Or type: where are my keys?"
          enterKeyHint="send"
          className="flex-1"
        />
        <Button type="submit" size="lg" disabled={!question.trim()}>
          <Mic className="size-5" />
          Ask
        </Button>
      </form>

      {(voice.error || client.lastError) && <p className="text-sm text-destructive">{voice.error ?? client.lastError}</p>}
      <p className="text-xs text-muted-foreground">
        Frames: {perception.status}
        {perception.framesSent > 0 && `, ${perception.framesSent} sent`}
      </p>

      <div>
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Item status</h2>
        <ItemStatusPanel detections={perception.detections} />
      </div>
    </div>
  );
}
