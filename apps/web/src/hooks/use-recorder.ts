import { useCallback, useEffect, useRef, useState } from "react";

export type LocalRecording = {
  id: string;
  url: string;
  file: File;
  startedAt: Date;
  durationMs: number;
};

// MP4 first because it plays everywhere, including the iPhone Photos app.
const TYPES = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
const VIDEO_BITS_PER_SECOND = 2_500_000;
// A recording sits in the phone's memory until someone saves it. At the bit rate
// above, ten minutes is about 190 MB.
const MAX_RECORDING_MS = 10 * 60 * 1000;

// Local time, to match the time shown next to the recording.
function fileName(startedAt: Date, mimeType: string) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}`;
  const time = `${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}`;
  return `headset-${date}-${time}.${mimeType.includes("webm") ? "webm" : "mp4"}`;
}

// Records a camera stream to a file on the device. Nothing uploads it. The
// camera stream has no mic track, so recordings are video only.
export function useRecorder(stream: MediaStream | null) {
  const [recording, setRecording] = useState(false);
  const [recordings, setRecordings] = useState<LocalRecording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const urlsRef = useRef<string[]>([]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(() => {
    if (!stream || recorderRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      setError("This browser can't record video.");
      return;
    }

    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start recording.");
      return;
    }

    const chunks: Blob[] = [];
    const startedAt = new Date();
    const limit = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, MAX_RECORDING_MS);

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => setError("Recording failed."));
    recorder.addEventListener("stop", () => {
      window.clearTimeout(limit);
      recorderRef.current = null;
      setRecording(false);
      if (chunks.length === 0) return;
      const type = recorder.mimeType || mimeType || "video/mp4";
      const file = new File(chunks, fileName(startedAt, type), { type });
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      setRecordings((previous) => [
        { id: url, url, file, startedAt, durationMs: Date.now() - startedAt.getTime() },
        ...previous,
      ]);
    });

    // A chunk a second, so a crash loses at most the last second of what was flushed.
    recorder.start(1000);
    recorderRef.current = recorder;
    setError(null);
    setRecording(true);
  }, [stream]);

  // A new camera stream means the recorded track is gone. Stop and keep the file.
  useEffect(() => stop, [stream, stop]);

  useEffect(() => {
    const urls = urlsRef;
    return () => urls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  return { recording, recordings, error, start, stop };
}
