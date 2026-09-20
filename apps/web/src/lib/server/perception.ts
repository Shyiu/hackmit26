import "server-only";
import { HttpError } from "./api";
import { mintDeviceToken } from "./auth";
import { optionalEnv } from "./env";
import type { PatientId } from "@memory-glasses/db";

/**
 * Calls services/perception on behalf of one wearer. Face embeddings are made
 * and stored there, in the same process that matches them, so the web app only
 * forwards the photo and never sees an embedding.
 */
export async function perceptionFetch(patientId: PatientId, path: string, init: RequestInit): Promise<Response> {
  const { token } = await mintDeviceToken({ patientId, deviceId: null, tokenVersion: 0, scope: "api", ttlSeconds: 60 });
  const base = optionalEnv("PERCEPTION_HTTP_URL") ?? "http://localhost:8000";
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(503, "The face service isn't reachable. Check that services/perception is running.");
  }
}

/** The service's own message for a rejected enrollment, like "each photo must contain exactly one face". */
export async function perceptionError(response: Response): Promise<HttpError> {
  const body: unknown = await response.json().catch(() => null);
  const detail = typeof body === "object" && body !== null && "detail" in body ? body.detail : null;
  const message = typeof detail === "string" ? detail : "The face service rejected that request";
  return new HttpError(response.status === 422 ? 400 : 502, message);
}
