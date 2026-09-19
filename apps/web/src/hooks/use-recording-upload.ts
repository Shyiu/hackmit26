import { useEffect, useRef, useState } from "react";
import { uploadRecording, type UploadProgress, type UploadStatus } from "@/lib/client/recording-upload";
import type { LocalRecording } from "./use-recorder";

// Opt-in upload of finished recordings. Off (the default) it does nothing and
// the files stay on the phone. On, each new recording is uploaded once, in the
// background; a network drop pauses the job and it picks up at the next part.
// Turning upload off mid-way stops the job; turning it back on resumes it from
// the parts that already landed.
export function useRecordingUpload(recordings: LocalRecording[], enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, UploadStatus>>({});
  const jobsRef = useRef(new Map<string, AbortController>());
  const progressRef = useRef(new Map<string, UploadStatus>());

  useEffect(() => {
    const jobs = jobsRef.current;
    const progress = progressRef.current;
    if (!enabled) {
      jobs.forEach((job) => job.abort());
      jobs.clear();
      return;
    }
    for (const recording of recordings) {
      const last = progress.get(recording.id);
      if (jobs.has(recording.id) || last?.state === "done" || last?.state === "failed") continue;
      const controller = new AbortController();
      jobs.set(recording.id, controller);
      const setStatus = (status: UploadStatus) => {
        if (controller.signal.aborted) return;
        progress.set(recording.id, status);
        setStatuses((current) => ({ ...current, [recording.id]: status }));
      };
      const resume: UploadProgress | undefined =
        last && "recordingId" in last
          ? { recordingId: last.recordingId, partsDone: last.partsDone, partsTotal: last.partsTotal }
          : undefined;
      setStatus({ state: "queued" });
      void uploadRecording(
        {
          sessionId: recording.sessionId,
          file: recording.file,
          mimeType: recording.file.type,
          startedAt: recording.startedAt,
          durationMs: recording.durationMs,
          width: recording.width,
          height: recording.height,
        },
        setStatus,
        { signal: controller.signal, resume },
      ).finally(() => {
        if (jobs.get(recording.id) === controller) jobs.delete(recording.id);
      });
    }
  }, [enabled, recordings]);

  useEffect(() => {
    const jobs = jobsRef.current;
    return () => jobs.forEach((job) => job.abort());
  }, []);

  return statuses;
}
