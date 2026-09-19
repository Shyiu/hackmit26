"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Circle, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CameraSelect } from "@/components/wearer/camera-select";
import { Hud, turnEndCaption } from "@/components/wearer/hud";
import { LiveVideo } from "@/components/wearer/live-video";
import { RecordingsList } from "@/components/wearer/recordings-list";
import { CAMERA_SETTING, parseCameraChoice, useCamera, type CameraChoice } from "@/hooks/use-camera";
import { useHudMessage } from "@/hooks/use-hud-message";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { useRecorder } from "@/hooks/use-recorder";
import { useWakeLock } from "@/hooks/use-screen";
import { readStoredString, writeStoredString } from "@/hooks/use-stored-setting";
import { useVideoAspect } from "@/hooks/use-video-frames";
import { playListeningChime } from "@/lib/tones";

// Capture path A: the headset client on a flat page. Same camera, mic, recorder,
// and HUD as /headset, with one unsplit video instead of two eye views.
export function SimulatorView() {
  const { stream, status, error, cameras, start: startCamera } = useCamera();
  const recorder = useRecorder(stream);
  const hud = useHudMessage();
  const talk = usePushToTalk({
    onTurnEnd: (outcome) => hud.show("caption", turnEndCaption(outcome)),
  });
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const aspect = useVideoAspect(video);
  const audioRef = useRef<AudioContext | null>(null);
  const live = status === "live";
  useWakeLock(live);

  useEffect(() => {
    void startCamera(parseCameraChoice(readStoredString(CAMERA_SETTING)));
  }, [startCamera]);

  function handlePress() {
    if (!live) return;
    audioRef.current ??= new AudioContext();
    void audioRef.current.resume();
    playListeningChime(audioRef.current);
    void talk.press();
  }

  function handleCameraChange(choice: CameraChoice) {
    writeStoredString(CAMERA_SETTING, JSON.stringify(choice));
    void startCamera(choice);
  }

  const onSpace = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== " " || event.repeat) return;
    if (event.target instanceof Element && event.target.closest("input, select, textarea")) return;
    event.preventDefault();
    if (event.type === "keydown") handlePress();
    else talk.release();
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

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <div className="relative w-full bg-black" style={{ aspectRatio: aspect }}>
            <LiveVideo
              stream={stream}
              onElement={setVideo}
              className="absolute inset-0 size-full object-contain"
            />
            <Hud
              className="inset-x-[8%]"
              message={hud.message}
              messageVisible={hud.visible}
              listening={talk.listening}
              recording={recorder.recording}
            />
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        {(status === "idle" || status === "starting") && "Asking for camera access..."}
        {live &&
          "Camera is live. Hold the button or the space bar to ask. Answers and frame upload aren't wired up yet."}
        {status === "error" && `Camera unavailable: ${error}`}
      </p>
      {talk.error && <p className="text-sm text-destructive">{talk.error}</p>}
      {recorder.error && <p className="text-sm text-destructive">{recorder.error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Button
          size="lg"
          disabled={!live}
          className="touch-none select-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            handlePress();
          }}
          onPointerUp={talk.release}
          onPointerCancel={talk.release}
        >
          <Mic />
          {talk.listening ? "Listening..." : "Hold to ask"}
        </Button>
        <Button
          size="lg"
          variant={recorder.recording ? "destructive" : "outline"}
          disabled={!live}
          onClick={recorder.recording ? recorder.stop : recorder.start}
        >
          {recorder.recording ? <Square /> : <Circle />}
          {recorder.recording ? "Stop recording" : "Record"}
        </Button>
        <CameraSelect
          cameras={cameras}
          activeDeviceId={stream?.getVideoTracks()[0]?.getSettings().deviceId}
          onChange={handleCameraChange}
        />
      </div>
      <RecordingsList recordings={recorder.recordings} />
    </div>
  );
}
