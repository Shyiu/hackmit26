import "server-only";

import type { ScanLiveState, ScanPin } from "@memory-glasses/shared";
import type { PatientId, TenantRepos } from "@memory-glasses/db";
import { HttpError } from "./api";
import { optionalEnv } from "./env";

// The splat-slam server: it takes the phone's frames, runs SLAM and splat training, and
// publishes a growing splat. The browser never talks to it; these routes proxy, so its
// key stays on the server and a caller only ever reaches their own wearer's scene.

const TIMEOUT_MS = 8_000;
const SCENE_TTL_MS = 10_000;

export type SlamScene = { id: string; name: string; created: number } & Record<string, unknown>;

declare global {
  // On globalThis so every route bundle and hot reload shares one cache.
  var __memoryGlassesScan:
    | {
        /** patient hex -> their current scene id. Short-lived: a reset elsewhere moves it. */
        current: Map<string, { sceneId: string; loadedAt: number }>;
        /** scene id -> name. Names never change, so this never expires. */
        names: Map<string, string>;
        creating: Map<string, Promise<SlamScene>>;
      }
    | undefined;
}

function cache() {
  return (globalThis.__memoryGlassesScan ??= { current: new Map(), names: new Map(), creating: new Map() });
}

export function scanConfigured(): boolean {
  return Boolean(optionalEnv("SPLAT_SLAM_URL"));
}

export function sceneNameFor(patientId: PatientId): string {
  return `mg-${patientId.toHexString()}`;
}

/**
 * One request to splat-slam. Non-2xx answers come back as they are; the caller decides.
 * `stream` is for a body handed on to the browser: the timeout then covers the wait for
 * headers only, because a timer that stays live would cut a large splat off mid-file.
 */
export async function slamFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number; stream?: boolean } = {},
): Promise<Response> {
  const base = optionalEnv("SPLAT_SLAM_URL");
  if (!base) throw new HttpError(503, "Live room scans are off: SPLAT_SLAM_URL is not set.");
  const { timeoutMs = TIMEOUT_MS, stream = false, ...rest } = init;
  let url: URL;
  try {
    url = new URL(`${base.replace(/\/+$/, "")}${path}`);
  } catch {
    throw new HttpError(502, "SPLAT_SLAM_URL is not a valid URL. It needs a scheme, like http://127.0.0.1:8420.");
  }
  const key = optionalEnv("SPLAT_SLAM_KEY");
  if (key) url.searchParams.set("k", key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...rest, cache: "no-store", signal: controller.signal });
  } catch {
    clearTimeout(timer);
    throw new HttpError(502, "The splat-slam server isn't reachable. Start it with splat-slam serve.");
  }
  // Left running for a body read here, so a reply that stalls still ends. Firing after
  // the body is read does nothing.
  if (stream) clearTimeout(timer);
  else timer.unref();
  if (response.status === 403) {
    throw new HttpError(502, "The splat-slam server rejected the app's key. Set SPLAT_SLAM_KEY to the key it was started with.");
  }
  return response;
}

async function slamJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await slamFetch(path, init);
  if (!response.ok) throw new HttpError(502, `The splat-slam server answered ${response.status}`);
  return readJson<T>(response);
}

/** A body that stalls or isn't JSON is the upstream's fault, so 502 and not 500. */
export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpError(502, "The splat-slam server sent a reply that isn't JSON");
  }
}

function remember(patientId: PatientId, scene: SlamScene): SlamScene {
  cache().current.set(patientId.toHexString(), { sceneId: scene.id, loadedAt: Date.now() });
  cache().names.set(scene.id, scene.name);
  return scene;
}

/** Starts a fresh scene for this wearer. The old one stays on the splat-slam server. */
export function createScene(patientId: PatientId): Promise<SlamScene> {
  const key = patientId.toHexString();
  // Two first requests at once (dashboard poll, phone frame) must not make two scenes.
  const pending = cache().creating.get(key);
  if (pending) return pending;
  const created = slamJson<SlamScene>("/api/scenes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: sceneNameFor(patientId) }),
  })
    .then((scene) => remember(patientId, scene))
    .finally(() => cache().creating.delete(key));
  cache().creating.set(key, created);
  return created;
}

/** The wearer's scene with its state: the newest one named for them, made if there is none. */
export async function findOrCreateScene(patientId: PatientId): Promise<SlamScene> {
  const name = sceneNameFor(patientId);
  const scenes = await slamJson<SlamScene[]>("/api/scenes");
  const mine = scenes.filter((scene) => scene.name === name).sort((a, b) => b.created - a.created)[0];
  return mine ? remember(patientId, mine) : createScene(patientId);
}

/** Just the id, for the frame path: cached so 4 frames a second don't list scenes each time. */
export async function currentSceneId(patientId: PatientId): Promise<string> {
  const cached = cache().current.get(patientId.toHexString());
  if (cached && Date.now() - cached.loadedAt < SCENE_TTL_MS) return cached.sceneId;
  return (await findOrCreateScene(patientId)).id;
}

export function forgetCurrentScene(patientId: PatientId) {
  cache().current.delete(patientId.toHexString());
}

/** A scene id from the URL. Someone else's scene is a 404, the same as one that doesn't exist. */
export async function assertSceneOwned(patientId: PatientId, sceneId: string): Promise<void> {
  if (!/^[\w-]{1,100}$/.test(sceneId)) throw new HttpError(404, "Not found");
  let name = cache().names.get(sceneId);
  if (name === undefined) {
    const response = await slamFetch(`/api/scenes/${sceneId}`);
    if (response.status === 404) throw new HttpError(404, "Not found");
    if (!response.ok) throw new HttpError(502, `The splat-slam server answered ${response.status}`);
    name = (await readJson<SlamScene>(response)).name;
    cache().names.set(sceneId, name);
  }
  if (name !== sceneNameFor(patientId)) throw new HttpError(404, "Not found");
}

export async function liveState(patientId: PatientId): Promise<ScanLiveState> {
  if (!scanConfigured()) return { configured: false, reachable: false, sceneId: null, scene: null };
  try {
    const scene = await findOrCreateScene(patientId);
    return { configured: true, reachable: true, sceneId: scene.id, scene };
  } catch (error) {
    if (error instanceof HttpError && error.status === 502) {
      console.warn("splat-slam:", error.message);
      return { configured: true, reachable: false, sceneId: null, scene: null };
    }
    throw error;
  }
}

/** Pins as the API returns them. A pin whose item is gone or archived is dropped. */
export async function pinViews(
  tenant: TenantRepos,
  docs: Awaited<ReturnType<TenantRepos["scanPins"]["listByScene"]>>,
): Promise<ScanPin[]> {
  if (docs.length === 0) return [];
  const names = new Map((await tenant.items.list()).map((item) => [item._id.toHexString(), item.name]));
  return docs.flatMap((doc) => {
    const itemId = String(doc.itemId);
    const itemName = names.get(itemId);
    if (itemName === undefined) return [];
    return [
      {
        itemId,
        itemName,
        sceneId: doc.sceneId,
        position: doc.position,
        observation: doc.observation,
        source: doc.source,
        seenAt: doc.seenAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      },
    ];
  });
}
