"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import type { Detection } from "@memory-glasses/shared";
import { turnEndCaption } from "@/components/wearer/hud";
import { CAMERA_SETTING, parseCameraChoice, useCamera, type CameraChoice } from "@/hooks/use-camera";
import { holdTimeMs, useHudMessage } from "@/hooks/use-hud-message";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { useRecorder } from "@/hooks/use-recorder";
import { enterFullscreen, useWakeLock, useWindowHeight } from "@/hooks/use-screen";
import { readStoredString, useStoredNumber, writeStoredString } from "@/hooks/use-stored-setting";
import { useFeedWatchdog, useVideoAspect } from "@/hooks/use-video-frames";
import { playListeningChime, playStallTone } from "@/lib/tones";
import { SetupPanel } from "./setup-panel";
import { StereoView } from "./stereo-view";

// About 63 mm between the lens centers, at the roughly 0.16 mm per CSS pixel most
// phones use. The setup panel calibrates it per phone and shell.
const DEFAULT_EYE_SPACING_PX = 390;

const SAMPLE_ANSWER =
  "I last saw your keys on the kitchen counter, next to the coffee maker, about twenty minutes ago.";
const SAMPLE_NOTICE = "I can see your keys.";
const TEST_LABEL: Detection = {
  itemId: "test",
  label: "Test label",
  bbox: [0.4, 0.35, 0.2, 0.3],
  confidence: 1,
};

const HOLD_KEYS = new Set([" ", "Enter"]);
// Presentation clickers send these with the key-up right behind the key-down, so
// they toggle listening instead of holding it.
const TOGGLE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);

export function HeadsetView() {
  const { stream, status, error: cameraError, cameras, start: startCamera } = useCamera();
  const recorder = useRecorder(stream);
  const hud = useHudMessage();
  const talk = usePushToTalk({
    onTurnEnd: (outcome) => hud.show("caption", turnEndCaption(outcome)),
  });
  const [eyeSpacing, setEyeSpacing] = useStoredNumber("headset.eyeSpacingPx", DEFAULT_EYE_SPACING_PX);
  const [zoom, setZoom] = useStoredNumber("headset.zoom", 1);
  const [textScale, setTextScale] = useStoredNumber("headset.textScale", 1);
  const [panelOpen, setPanelOpen] = useState(true);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [testLabels, setTestLabels] = useState<Detection[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const labelTimerRef = useRef<number | null>(null);

  const live = status === "live";
  // Once the camera has been started, keep watching even if it errors out. A camera
  // the phone shut down leaves its last frame on screen, and that has to be covered.
  const started = status !== "idle";
  const aspect = useVideoAspect(video);
  const viewportHeight = useWindowHeight();
  const wakeLock = useWakeLock(started);
  const stalled = useFeedWatchdog(video, started);

  // On iPhone an AudioContext only makes sound if it's resumed inside a tap.
  function resumeAudio() {
    audioRef.current ??= new AudioContext();
    void audioRef.current.resume();
    return audioRef.current;
  }

  async function handleStart() {
    if (live) {
      setPanelOpen(false);
      return;
    }
    // Both need the tap that got us here, so they go before the first await.
    resumeAudio();
    void enterFullscreen();
    const started = await startCamera(parseCameraChoice(readStoredString(CAMERA_SETTING)));
    await talk.prime();
    if (started) setPanelOpen(false);
  }

  function handleCameraChange(choice: CameraChoice) {
    writeStoredString(CAMERA_SETTING, JSON.stringify(choice));
    void startCamera(choice);
  }

  function handlePress() {
    if (!live || panelOpen) return;
    playListeningChime(resumeAudio());
    void talk.press();
  }

  function handleTestCaption() {
    setPanelOpen(false);
    hud.show("caption", SAMPLE_ANSWER);
  }

  function handleTestNotice() {
    setPanelOpen(false);
    hud.show("notice", SAMPLE_NOTICE);
    setTestLabels([TEST_LABEL]);
    if (labelTimerRef.current !== null) window.clearTimeout(labelTimerRef.current);
    labelTimerRef.current = window.setTimeout(() => setTestLabels([]), holdTimeMs(SAMPLE_NOTICE));
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.repeat || panelOpen || !live) return;
    if (HOLD_KEYS.has(event.key)) {
      event.preventDefault();
      handlePress();
    } else if (TOGGLE_KEYS.has(event.key)) {
      event.preventDefault();
      if (talk.listening) talk.release();
      else handlePress();
    }
  });

  const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (HOLD_KEYS.has(event.key)) talk.release();
  });

  useEffect(() => {
    const down = (event: KeyboardEvent) => onKeyDown(event);
    const up = (event: KeyboardEvent) => onKeyUp(event);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const onStall = useEffectEvent(() => {
    if (audioRef.current) playStallTone(audioRef.current);
  });

  // Repeat the tone so the spotter hears it too, not only the wearer.
  useEffect(() => {
    if (!stalled) return;
    onStall();
    const timer = window.setInterval(() => onStall(), 3000);
    return () => window.clearInterval(timer);
  }, [stalled]);

  return (
    <div className="dark fixed inset-0 overflow-hidden bg-black text-foreground select-none">
      <div
        className="absolute inset-0 touch-none [-webkit-touch-callout:none]"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          handlePress();
        }}
        onPointerUp={talk.release}
        onPointerCancel={talk.release}
      >
        <StereoView
          stream={stream}
          onVideoElement={setVideo}
          aspect={aspect}
          viewportHeight={viewportHeight}
          eyeSpacing={eyeSpacing}
          zoom={zoom}
          textScale={textScale}
          labels={testLabels}
          message={hud.message}
          messageVisible={hud.visible}
          listening={talk.listening}
          recording={recorder.recording}
          stalled={stalled}
        />
        <button
          type="button"
          aria-label="Headset setup"
          className="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 p-2 text-white/80"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPanelOpen(true)}
        >
          <Settings2 className="size-5" />
        </button>
        <p className="absolute inset-0 z-20 hidden items-center justify-center bg-black p-8 text-center text-xl text-white portrait:flex">
          Turn the phone sideways.
        </p>
      </div>

      {panelOpen && (
        <SetupPanel
          live={live}
          starting={status === "starting"}
          cameraError={cameraError}
          micAllowed={talk.micAllowed}
          micError={talk.error}
          stream={stream}
          cameras={cameras}
          eyeSpacing={eyeSpacing}
          zoom={zoom}
          textScale={textScale}
          wakeLock={wakeLock}
          recorder={recorder}
          onStart={() => void handleStart()}
          onCameraChange={handleCameraChange}
          onEyeSpacingChange={setEyeSpacing}
          onZoomChange={setZoom}
          onTextScaleChange={setTextScale}
          onTestCaption={handleTestCaption}
          onTestNotice={handleTestNotice}
        />
      )}
    </div>
  );
}
