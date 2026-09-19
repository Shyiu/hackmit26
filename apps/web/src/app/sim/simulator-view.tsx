"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useState, type FormEvent } from "react";
import { Circle, Mic, Pause, Play, Square } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraSelect } from "@/components/wearer/camera-select";
import { Hud, ItemLabels, StallCard } from "@/components/wearer/hud";
import { LiveVideo } from "@/components/wearer/live-video";
import { RecordingsList } from "@/components/wearer/recordings-list";
import { useVideoAspect } from "@/hooks/use-video-frames";
import { useWearerClient } from "@/hooks/use-wearer-client";
import { cn } from "@/lib/utils";

// Capture path A: the same client as /wear, with one video on the page, labels
// from the perception service, hold-to-ask, and a typed question for testing
// without speech to text.
export function SimulatorView() {
  const client = useWearerClient({ turnMode: "hold" });
  const { camera, recorder, hud, voice, perception, live, capturing } = client;
  const aspect = useVideoAspect(client.video);
  const [question, setQuestion] = useState("");

  const startOnMount = useEffectEvent(() => void client.start());
  useEffect(() => startOnMount(), []);

  const onSpace = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== " " || event.repeat) return;
    if (event.target instanceof Element && event.target.closest("input, select, textarea, button")) return;
    event.preventDefault();
    if (event.type === "keydown") client.beginTurn();
    else client.finishTurn();
  });

  useEffect(() => {
    const handle = (event: KeyboardEvent) => onSpace(event);
    window.addEventListener("keydown", handle);
    window.addEventListener("keyup", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      window.removeEventListener("keyup", handle);
    };
  }, []);

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
        : voice.listening
          ? voice.interim || "Listening…"
          : client.answer === "thinking"
            ? "Looking it up…"
            : "Hold the button or the space bar to ask, or type a question.";

  return (
    <div className="flex flex-col gap-4">
      {client.signedIn === false && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>Sign in first. Answers and frame upload use the caregiver session.</p>
          <Link href="/login?next=/sim" className={buttonVariants()}>
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
          recording={recorder.recording}
        />
        <span
          className={cn(
            "absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white",
          )}
        >
          <span className={cn("size-2 rounded-full", capturing ? "animate-pulse bg-emerald-400" : "bg-amber-400")} />
          {capturing ? "Capturing" : "Paused"}
        </span>
        {client.stalled && <StallCard />}
      </div>

      <p className="min-h-6 text-sm text-muted-foreground" aria-live="polite">
        {status}
      </p>

      <Button
        size="lg"
        disabled={!live}
        className="h-16 w-full touch-none text-base select-none pointer-coarse:h-16"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          client.beginTurn();
        }}
        onPointerUp={client.finishTurn}
        onPointerCancel={client.finishTurn}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Mic className="size-5" />
        {voice.listening ? "Listening… let go to ask" : "Hold to ask"}
      </Button>

      <form onSubmit={submitQuestion} className="flex gap-2">
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Or type: where are my keys?"
          enterKeyHint="send"
          className="flex-1"
        />
        <Button type="submit" size="lg" disabled={!question.trim()}>
          Ask
        </Button>
      </form>

      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" variant={capturing ? "outline" : "default"} disabled={!live} onClick={capturing ? client.pause : client.resume}>
          {capturing ? <Pause /> : <Play />}
          {capturing ? "Pause" : "Resume capture"}
        </Button>
        <Button
          size="lg"
          variant={recorder.recording ? "destructive" : "outline"}
          disabled={!live || !client.recordingAllowed || (!capturing && !recorder.recording)}
          onClick={recorder.recording ? recorder.stop : client.startRecording}
        >
          {recorder.recording ? <Square /> : <Circle />}
          {recorder.recording ? "Stop" : "Record"}
        </Button>
      </div>
      {!client.recordingAllowed && (
        <p className="text-sm text-muted-foreground">Recording is off until a caregiver allows it in settings.</p>
      )}

      <CameraSelect
        cameras={camera.cameras}
        activeDeviceId={camera.stream?.getVideoTracks()[0]?.getSettings().deviceId}
        onChange={client.changeCamera}
      />

      {(voice.error || recorder.error || client.lastError) && (
        <p className="text-sm text-destructive">{voice.error ?? recorder.error ?? client.lastError}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Speech to text: {voice.engine ?? "not checked yet"} · Frames: {perception.status}
        {perception.framesSent > 0 && `, ${perception.framesSent} sent`}
      </p>
      <RecordingsList recordings={recorder.recordings} uploads={client.uploads} />
    </div>
  );
}
