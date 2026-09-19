"use client";

import { Circle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraSelect } from "@/components/wearer/camera-select";
import { RecordingsList } from "@/components/wearer/recordings-list";
import type { CameraChoice } from "@/hooks/use-camera";
import type { useRecorder } from "@/hooks/use-recorder";
import { useDisplayMode, type useWakeLock } from "@/hooks/use-screen";

type SetupPanelProps = {
  live: boolean;
  starting: boolean;
  cameraError: string | null;
  micAllowed: boolean;
  micError: string | null;
  stream: MediaStream | null;
  cameras: MediaDeviceInfo[];
  eyeSpacing: number;
  zoom: number;
  textScale: number;
  wakeLock: ReturnType<typeof useWakeLock>;
  recorder: ReturnType<typeof useRecorder>;
  onStart: () => void;
  onCameraChange: (choice: CameraChoice) => void;
  onEyeSpacingChange: (value: number) => void;
  onZoomChange: (value: number) => void;
  onTextScaleChange: (value: number) => void;
  onTestCaption: () => void;
  onTestNotice: () => void;
};

// Everything that needs the phone out of the shell: start, camera and lens
// choice, eye calibration, recording, and the readouts for the M0 smoke test.
export function SetupPanel({
  live,
  starting,
  cameraError,
  micAllowed,
  micError,
  stream,
  cameras,
  eyeSpacing,
  zoom,
  textScale,
  wakeLock,
  recorder,
  onStart,
  onCameraChange,
  onEyeSpacingChange,
  onZoomChange,
  onTextScaleChange,
  onTestCaption,
  onTestNotice,
}: SetupPanelProps) {
  const displayMode = useDisplayMode();
  const track = stream?.getVideoTracks()[0];
  const settings = track?.getSettings();
  const resolution = settings?.width && settings.height ? `, ${settings.width}x${settings.height}` : "";

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-black/90 text-white">
      <div className="mx-auto flex max-w-xl flex-col gap-6 p-6 text-sm">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Headset setup</h1>
          <p className="text-white/70">
            Turn the phone sideways, tap Start, and put it in the headset. To ask, touch the
            screen through the finger slot and hold. The button at the top middle of the screen
            brings this panel back.
          </p>
        </header>

        <Button size="lg" onClick={onStart} disabled={starting}>
          {live ? "Back to the headset" : starting ? "Starting..." : "Start"}
        </Button>
        {cameraError && <p className="text-red-400">{cameraError}</p>}

        <section className="flex flex-col gap-4">
          <h2 className="font-medium">View</h2>
          <CameraSelect cameras={cameras} activeDeviceId={settings?.deviceId} onChange={onCameraChange} />
          <Slider
            label="Eye spacing"
            hint="Distance between the two image centers. Match it to the distance between the lens centers."
            value={eyeSpacing}
            min={160}
            max={640}
            step={2}
            format={(value) => `${value} px`}
            onChange={onEyeSpacingChange}
          />
          <Slider
            label="Zoom"
            value={zoom}
            min={0.5}
            max={2}
            step={0.05}
            format={(value) => `${value.toFixed(2)}x`}
            onChange={onZoomChange}
          />
          <Slider
            label="Text size"
            value={textScale}
            min={0.75}
            max={1.75}
            step={0.05}
            format={(value) => `${value.toFixed(2)}x`}
            onChange={onTextScaleChange}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!live} onClick={onTestCaption}>
              Test caption
            </Button>
            <Button variant="outline" disabled={!live} onClick={onTestNotice}>
              Test notification
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Recording</h2>
          <p className="text-white/70">Video only, no sound. It stays on this phone until you save it.</p>
          <Button
            variant={recorder.recording ? "destructive" : "outline"}
            disabled={!live}
            onClick={recorder.recording ? recorder.stop : recorder.start}
            className="self-start"
          >
            {recorder.recording ? <Square /> : <Circle />}
            {recorder.recording ? "Stop recording" : "Start recording"}
          </Button>
          {recorder.error && <p className="text-red-400">{recorder.error}</p>}
          <RecordingsList recordings={recorder.recordings} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-medium">This phone</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-white/80">
            <dt>Camera</dt>
            <dd>{track ? `${track.label || "unnamed"}${resolution}` : "not open"}</dd>
            <dt>Microphone</dt>
            <dd>{micError ?? (micAllowed ? "allowed" : "not asked yet")}</dd>
            <dt>Screen stays on</dt>
            <dd>{!wakeLock.supported ? "not supported" : wakeLock.held ? "yes" : "no"}</dd>
            <dt>Display</dt>
            <dd>{displayMode}</dd>
          </dl>
          <p className="text-white/50">Write these down with the M0 smoke test.</p>
        </section>

        <p className="text-white/50">
          Not built yet: spoken answers, frame upload to the perception service, and item labels
          from real detections.
        </p>
      </div>
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between gap-4">
        <span>{label}</span>
        <span className="text-white/60 tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-white"
      />
      {hint && <span className="text-white/50">{hint}</span>}
    </label>
  );
}
