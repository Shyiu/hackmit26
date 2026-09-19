import type { RecordingChunkUpload } from "@memory-glasses/shared";

// Sends a finished local recording to the bucket through the app's own API:
// register once, then one signed PUT per fixed-size part. Progress is kept per
// part, so a network drop resumes at the next part instead of starting over.
// Nothing here runs unless the caregiver turned upload on; see useRecordingUpload.

export const PART_BYTES = 4 * 1024 * 1024;

export type UploadSource = {
  /** Stable per recording; registration is idempotent on it. */
  sessionId: string;
  file: Blob;
  mimeType: string;
  startedAt: Date;
  durationMs: number;
  width: number;
  height: number;
};

export type UploadProgress = {
  recordingId: string | null;
  partsDone: number;
  partsTotal: number;
};

export type UploadStatus =
  | { state: "queued" }
  | ({ state: "uploading" } & UploadProgress)
  | ({ state: "waiting"; error: string } & UploadProgress)
  | ({ state: "done" } & UploadProgress)
  | { state: "failed"; error: string };

type SignedPart = RecordingChunkUpload & { headers?: Record<string, string> };

export type UploadTransport = {
  register(source: UploadSource): Promise<{ _id: string }>;
  signPart(recordingId: string, part: { seq: number; startedAt: Date; durationMs: number; bytes: number; final: boolean }): Promise<SignedPart>;
  put(signed: SignedPart, body: Blob): Promise<void>;
};

async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with ${response.status}`;
    throw new UploadError(response.status, message);
  }
  return body as T;
}

export class UploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** 4xx other than a rate limit is the server saying no; retrying won't change that. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

export const fetchTransport: UploadTransport = {
  async register(source) {
    const response = await fetch("/api/recordings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: source.sessionId,
        startedAt: source.startedAt.toISOString(),
        mimeType: source.mimeType,
        width: source.width,
        height: source.height,
        hasAudio: false,
      }),
    });
    return readJson(response);
  },
  async signPart(recordingId, part) {
    const response = await fetch(`/api/recordings/${recordingId}/chunks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...part, startedAt: part.startedAt.toISOString() }),
    });
    return readJson(response);
  },
  async put(signed, body) {
    const response = await fetch(signed.uploadUrl, { method: "PUT", headers: signed.headers ?? {}, body });
    if (!response.ok) throw new UploadError(response.status, `Storage answered ${response.status}`);
  },
};

export function partCount(bytes: number) {
  return Math.max(1, Math.ceil(bytes / PART_BYTES));
}

const RETRY_MS = [2_000, 5_000, 10_000, 30_000];

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Uploads one recording, reporting progress. Transient failures (offline, 5xx,
 * 429) back off and retry from the part that failed; a refusal (403 when upload
 * is off, 404) ends the attempt. Resolves with the final status.
 */
export async function uploadRecording(
  source: UploadSource,
  onStatus: (status: UploadStatus) => void,
  {
    transport = fetchTransport,
    signal,
    resume,
  }: { transport?: UploadTransport; signal?: AbortSignal; resume?: UploadProgress } = {},
): Promise<UploadStatus> {
  const partsTotal = partCount(source.file.size);
  const msPerByte = source.file.size > 0 ? source.durationMs / source.file.size : 0;
  const progress: UploadProgress = { recordingId: null, partsDone: 0, ...resume, partsTotal };
  let attempt = 0;

  const report = (status: UploadStatus) => {
    onStatus(status);
    return status;
  };

  while (!signal?.aborted) {
    try {
      if (progress.recordingId === null) {
        report({ state: "uploading", ...progress });
        progress.recordingId = (await transport.register(source))._id;
      }
      while (progress.partsDone < partsTotal) {
        const seq = progress.partsDone;
        const start = seq * PART_BYTES;
        const body = source.file.slice(start, Math.min(start + PART_BYTES, source.file.size), source.mimeType);
        const signed = await transport.signPart(progress.recordingId, {
          seq,
          startedAt: new Date(source.startedAt.getTime() + Math.round(start * msPerByte)),
          durationMs: Math.round(body.size * msPerByte),
          bytes: body.size,
          final: seq === partsTotal - 1,
        });
        await transport.put(signed, body);
        progress.partsDone = seq + 1;
        attempt = 0;
        report({ state: "uploading", ...progress });
      }
      return report({ state: "done", ...progress });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      if (error instanceof UploadError && error.permanent) return report({ state: "failed", error: message });
      report({ state: "waiting", error: message, ...progress });
      await sleep(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)], signal);
      attempt += 1;
    }
  }
  return report({ state: "waiting", error: "Stopped", ...progress });
}
