import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "idle" | "starting" | "live" | "error";

// A camera the user picked. Saved by label as well as ID, because Safari can
// hand out new device IDs between visits.
export type CameraChoice = { deviceId: string; label: string };

export const CAMERA_SETTING = "wearer.camera";

export function parseCameraChoice(raw: string | null): CameraChoice | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CameraChoice>;
    return typeof value.deviceId === "string" && typeof value.label === "string"
      ? { deviceId: value.deviceId, label: value.label }
      : null;
  } catch {
    return null;
  }
}

const VIDEO: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } };

async function openCamera(deviceId?: string) {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...VIDEO, deviceId: { exact: deviceId } },
        audio: false,
      });
    } catch {
      // The saved ID is stale or the camera is gone. Take any rear camera instead.
    }
  }
  return navigator.mediaDevices.getUserMedia({
    video: { ...VIDEO, facingMode: { ideal: "environment" } },
    audio: false,
  });
}

function describeError(err: unknown) {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return "Camera permission was denied. Allow it in the browser's site settings.";
    }
    if (err.name === "NotFoundError") return "No camera found.";
    if (err.name === "NotReadableError") return "Another app is using the camera.";
  }
  return err instanceof Error ? err.message : "Could not open the camera.";
}

// The rear camera as a video-only MediaStream, at 1080p where the phone allows it.
// The mic is opened separately per question, see usePushToTalk.
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const choiceRef = useRef<CameraChoice | null>(null);
  const wantedRef = useRef(false);
  const requestRef = useRef(0);

  const start = useCallback(async (choice: CameraChoice | null) => {
    const request = ++requestRef.current;
    choiceRef.current = choice;
    wantedRef.current = true;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access needs HTTPS. Open this page over https:// or on localhost.");
      setStatus("error");
      return false;
    }

    setStatus("starting");
    setError(null);
    try {
      let next = await openCamera(choice?.deviceId);
      // Labels are only filled in once permission is granted, so list cameras now.
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "videoinput"
      );
      const activeId = next.getVideoTracks()[0]?.getSettings().deviceId;
      const saved =
        choice &&
        devices.find(
          (device) =>
            device.deviceId === choice.deviceId || (choice.label !== "" && device.label === choice.label)
        );
      if (saved && saved.deviceId !== activeId) {
        next.getTracks().forEach((track) => track.stop());
        next = await openCamera(saved.deviceId);
      }
      if (request !== requestRef.current) {
        next.getTracks().forEach((track) => track.stop());
        return false;
      }

      const opened = next;
      opened.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (streamRef.current !== opened) return;
        setError("The camera stopped.");
        setStatus("error");
      });
      streamRef.current = opened;
      setStream(opened);
      setCameras(devices);
      setStatus("live");
      return true;
    } catch (err) {
      if (request !== requestRef.current) return false;
      setStream(null);
      setError(describeError(err));
      setStatus("error");
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    requestRef.current++;
    wantedRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setStatus("idle");
  }, []);

  // Phones can end the camera track when the screen locks or the app is switched.
  // Reopen it when the page is visible again.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible" || !wantedRef.current) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === "ended") void start(choiceRef.current);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [start]);

  useEffect(() => {
    const streams = streamRef;
    return () => streams.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return { stream, status, error, cameras, start, stop };
}
