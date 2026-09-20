import type { PostScanObservationsBody, ScanFrameResult, ScanLiveState } from "@memory-glasses/shared";

// fetch for the app's own JSON API. Throws ApiError with the server's message,
// so a form can show "An item already answers to 'keys'" instead of a status code.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: json === undefined ? headers : { "content-type": "application/json", ...headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : // A body too large for the host is refused before the route, with no message of its own.
          response.status === 413
          ? "That upload is too large. Try fewer or smaller files."
          : `Request failed with ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return body as T;
}

// The live 3D room scan. See use-scan-feed.ts. Both calls give up after 20 s, which covers
// the server's worst case of two 8 s splat-slam calls: the feed allows one upload at a
// time, so a request stalled on a dropped tunnel would otherwise stop it for minutes.
const SCAN_TIMEOUT_MS = 20_000;

export function getScanLive() {
  return apiFetch<ScanLiveState>("/api/scan/live", { cache: "no-store", signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) });
}

/** `timeSeconds` is the sender's clock; splat-slam only compares it within one session. */
export function postScanFrame(jpeg: Blob, session: string, timeSeconds: number) {
  return apiFetch<ScanFrameResult>("/api/scan/live/frames", {
    method: "POST",
    body: jpeg,
    headers: { "content-type": "image/jpeg", "x-session": session, "x-time": timeSeconds.toFixed(3) },
    signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
  });
}

export function postScanObservations(body: PostScanObservationsBody) {
  return apiFetch<{ ok: true }>("/api/scan/observations", { method: "POST", json: body });
}
