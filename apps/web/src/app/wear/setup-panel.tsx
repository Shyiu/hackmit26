"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Circle, Square } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraSelect } from "@/components/wearer/camera-select";
import { PairForm } from "@/components/wearer/pair-form";
import { RecordingsList } from "@/components/wearer/recordings-list";
import { useDisplayMode } from "@/hooks/use-screen";
import type { WearerClient } from "@/hooks/use-wearer-client";

const SAMPLE_ANSWER =
  "I last saw your keys on the kitchen counter, next to the coffee maker, about twenty minutes ago.";

const ENGINE_LABELS = {
  deepgram: "Deepgram",
  browser: "the browser's own recognizer",
  none: "not set up",
} as const;

const PERCEPTION_LABELS = {
  off: "off",
  unconfigured: "no perception URL set",
  "signed-out": "sign in first",
  connecting: "connecting",
  connected: "connected",
  error: "reconnecting",
} as const;

// Everything that happens before the phone goes on the chest: start, capture,
// lens choice, recording, tests, and the readouts for the M0 smoke test.
export function SetupPanel({
  client,
  textScale,
  onTextScaleChange,
  onClose,
}: {
  client: WearerClient;
  textScale: number;
  onTextScaleChange: (value: number) => void;
  onClose: () => void;
}) {
  const displayMode = useDisplayMode();
  const [question, setQuestion] = useState("");
  const { camera, recorder, voice, perception, wakeLock, live, capturing } = client;
  const starting = camera.status === "starting";
  const track = camera.stream?.getVideoTracks()[0];
  const trackSettings = track?.getSettings();
  const resolution =
    trackSettings?.width && trackSettings.height ? `, ${trackSettings.width}×${trackSettings.height}` : "";
  const lensLabel =
    camera.lens === "ultrawide" ? " · 0.5× ultra wide" : camera.lens === "wide" ? " · 1× wide" : "";

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    client.askText(question);
    setQuestion("");
    onClose();
  }

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto overscroll-contain bg-page text-foreground">
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] text-base">
        <header className="flex flex-col gap-2">
          <Wordmark />
          <h1 className="text-2xl font-semibold tracking-tight">Wear setup</h1>
          <p className="text-sm text-muted-foreground">
            Tap Start, resume capture, then clip the phone into the chest harness with the rear
            camera facing out. Tap anywhere on the screen to ask a question, and tap again to
            cancel. Answers are spoken, so wear earbuds.
          </p>
        </header>

        {client.signedIn === false && (
          <div className="flex flex-col gap-3 rounded-lg border border-butter-deep/30 bg-butter-soft p-4">
            <div>
              <h2 className="font-medium">Pair this phone</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask the caregiver to open Dashboard → Settings → Pair a phone and read you the 6-digit code.
              </p>
            </div>
            <PairForm defaultLabel="Chest phone" />
          </div>
        )}

        <Panel>
          {!live ? (
            <Button size="lg" className="w-full" onClick={() => void client.start()} disabled={starting}>
              {starting ? "Starting…" : "Start"}
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button
                size="lg"
                variant={capturing ? "outline" : "default"}
                onClick={capturing ? client.pause : client.resume}
              >
                {capturing ? "Pause capture" : "Resume capture"}
              </Button>
              <Button size="lg" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
          {camera.error && <p className="text-sm text-destructive">{camera.error}</p>}
          <p className="text-sm text-muted-foreground">
            Capture starts paused. While paused, no frames leave the phone and recording stops.
            Pause before leaving the demo area.
          </p>
        </Panel>

        <Panel title="View">
          <CameraSelect
            cameras={camera.cameras}
            activeDeviceId={trackSettings?.deviceId}
            onChange={client.changeCamera}
          />
          <label className="flex flex-col gap-2">
            <span className="flex justify-between gap-4">
              <span>Caption size</span>
              <span className="text-muted-foreground tabular-nums">{textScale.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={0.75}
              max={1.75}
              step={0.05}
              value={textScale}
              onChange={(event) => onTextScaleChange(Number(event.target.value))}
              className="h-8 accent-brand"
            />
          </label>
        </Panel>

        <Panel title="Test">
          <Button
            variant="outline"
            size="lg"
            disabled={!live}
            onClick={() => {
              onClose();
              void client.askText("where are my keys");
            }}
          >
            Ask &ldquo;where are my keys?&rdquo;
          </Button>
          <Button
            variant="outline"
            size="lg"
            disabled={!live}
            onClick={() => {
              client.hud.show("caption", SAMPLE_ANSWER);
              onClose();
            }}
          >
            Show a sample caption
          </Button>
          <form onSubmit={submitQuestion} className="flex gap-2">
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Type a question"
              enterKeyHint="send"
              className="flex-1"
            />
            <Button type="submit" size="lg" disabled={!question.trim()}>
              Ask
            </Button>
          </form>
        </Panel>

        <Panel title="Recording">
          {client.recordingAllowed ? (
            <>
              <p className="text-sm text-muted-foreground">Video only, no sound. It stays on this phone until you save it.</p>
              <Button
                size="lg"
                variant={recorder.recording ? "destructive" : "outline"}
                disabled={!live || (!capturing && !recorder.recording)}
                onClick={recorder.recording ? recorder.stop : client.startRecording}
                className="self-start"
              >
                {recorder.recording ? <Square /> : <Circle />}
                {recorder.recording ? "Stop recording" : "Start recording"}
              </Button>
              {!capturing && !recorder.recording && (
                <p className="text-sm text-muted-foreground">Resume capture to record.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Recording is off. A caregiver can allow it in the dashboard settings.
            </p>
          )}
          {recorder.error && <p className="text-sm text-destructive">{recorder.error}</p>}
          <RecordingsList recordings={recorder.recordings} />
        </Panel>

        <Panel title="This phone">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt>Camera</dt>
            <dd className="break-words">{track ? `${track.label || "unnamed"}${resolution}${lensLabel}` : "not open"}</dd>
            <dt>Microphone</dt>
            <dd>{voice.error ?? (voice.micAllowed ? "allowed" : "not asked yet")}</dd>
            <dt>Speech to text</dt>
            <dd>{voice.engine ? ENGINE_LABELS[voice.engine] : "not checked yet"}</dd>
            <dt>Frame upload</dt>
            <dd>
              {PERCEPTION_LABELS[perception.status]}
              {perception.framesSent > 0 && `, ${perception.framesSent} frames sent`}
            </dd>
            <dt>Screen stays on</dt>
            <dd>{!wakeLock.supported ? "not supported" : wakeLock.held ? "yes" : "no"}</dd>
            <dt>Display</dt>
            <dd>{displayMode}</dd>
          </dl>
          {perception.error && perception.status !== "connected" && (
            <p className="text-sm text-muted-foreground">Frames: {perception.error}</p>
          )}
          {client.lastError && <p className="text-sm text-destructive">Last error: {client.lastError}</p>}
          <p className="text-sm text-muted-foreground">Write these down with the M0 smoke test.</p>
        </Panel>
      </div>
    </div>
  );
}

// The same white card the auth pages and dashboard content sit on.
function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4 shadow-[0_1px_2px_rgb(20_45_120/0.06)]">
      {title && <h2 className="font-medium">{title}</h2>}
      {children}
    </section>
  );
}
