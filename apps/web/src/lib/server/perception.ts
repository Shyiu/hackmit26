import "server-only";

import {
  reloadClassesResponseSchema,
  type ReloadClassesRequest,
} from "@memory-glasses/shared";
import {
  ObjectId,
  type FrameObservationDoc,
  type PatientId,
  type PersonId,
  type PublicPerson,
  type TenantRepos,
} from "@memory-glasses/db";
import { z } from "zod";
import { HttpError } from "./api";
import { mintDeviceToken } from "./auth";
import { optionalEnv } from "./env";

// The perception service's HTTP side, which owns face enrollment: it holds the
// embedder and the key the embeddings are encrypted with. The browser never talks
// to it for this; these calls carry a token scoped to one wearer.

function baseUrl(): string {
  const explicit = optionalEnv("PERCEPTION_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  // wss://host/ws/frames is the same server as https://host.
  const socket = optionalEnv("NEXT_PUBLIC_PERCEPTION_WS_URL");
  if (socket) return socket.replace(/^ws/, "http").replace(/\/ws\/frames\/?$/, "");
  return "http://127.0.0.1:8000";
}

export async function perceptionFetch(patientId: PatientId, path: string, init: RequestInit = {}): Promise<Response> {
  const { token } = await mintDeviceToken({ patientId, deviceId: null, tokenVersion: 0, scope: "api", ttlSeconds: 60 });
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    throw new HttpError(502, "The perception service isn't reachable. Start it with pnpm start.");
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new HttpError(
        502,
        "The perception service rejected the app's token. Set the same DEVICE_TOKEN_SECRET in apps/web/.env.local and services/perception/.env, then restart both servers.",
      );
    }
    const body = (await response.json().catch(() => null)) as { detail?: unknown; error?: { message?: unknown } } | null;
    const message = body?.error?.message ?? body?.detail;
    throw new HttpError(
      response.status === 422 ? 422 : response.status === 404 ? 404 : 502,
      typeof message === "string" ? message : `The perception service answered ${response.status}`,
    );
  }
  return response;
}

// Tells the perception service a caregiver changed this wearer's items. Fire-and-forget:
// an item edit must succeed even when perception is down, so failures are only logged.
export function reloadClasses(patientId: PatientId): void {
  void perceptionFetch(patientId, "/config/classes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({} satisfies ReloadClassesRequest),
    signal: AbortSignal.timeout(2_000),
  })
    .then(async (response) => {
      const parsed = reloadClassesResponseSchema.safeParse(await response.json());
      if (parsed.success) {
        console.info(
          `perception reloaded ${parsed.data.classes.length} classes (version ${parsed.data.version})`,
        );
      }
    })
    .catch((error: unknown) => {
      console.warn("perception class reload failed", error instanceof Error ? error.message : error);
    });
}

export type EnrolledPerson = {
  id: string;
  name: string;
  relation: string | null;
  photos: number;
  embeddingModel: string;
  createdAt: string;
  // The newest stored frame this person was matched in, if any.
  lastSeenAt: string | null;
  lastMatchConfidence: number | null;
};

export function personView(doc: PublicPerson, frames: FrameObservationDoc[] = []): EnrolledPerson {
  // Frames come newest first.
  const seen = frames.find((frame) => frame.faces.some((face) => face.personId?.equals(doc._id)));
  const face = seen?.faces.find((item) => item.personId?.equals(doc._id));
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    relation: doc.relation,
    photos: doc.referenceImageKeys.length,
    embeddingModel: doc.embeddingModel,
    createdAt: doc.createdAt.toISOString(),
    lastSeenAt: seen?.capturedAt.toISOString() ?? null,
    lastMatchConfidence: face?.matchConfidence ?? null,
  };
}

export type LastSeenPerson = { name: string; relation: string | null; seenAt: string };

// Matches perception's `person_recall_window_s` default: how far back "who is this" looks.
const PERSON_RECALL_WINDOW_MS = 10 * 60 * 1000;

/** The most recently recognized enrolled face, for "who is this" -- null when nobody's
 * been matched within the recall window (or ever). Read from Mongo, which perception
 * writes to, so it works wherever the web app runs. */
export async function getLastSeenPerson(tenant: TenantRepos): Promise<LastSeenPerson | null> {
  const person = await tenant.people.latestRecognized(PERSON_RECALL_WINDOW_MS);
  return person && { name: person.name, relation: person.relation, seenAt: person.seenAt.toISOString() };
}

export async function listPeople(tenant: TenantRepos): Promise<EnrolledPerson[]> {
  const [people, frames] = await Promise.all([tenant.people.list(), tenant.people.recentFramesWithFaces(100)]);
  return people.map((person) => personView(person, frames));
}

/** The perception service's answer to an enroll or add-photos call, as stored in `people`. */
export function personFromUpstream(body: unknown): PublicPerson {
  const parsed = upstreamPersonSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(502, "The perception service answered with an unexpected shape");
  const { _id, createdAt, consentedAt, expiresAt, ...rest } = parsed.data;
  return {
    ...rest,
    _id: new ObjectId(_id) as PersonId,
    patientId: new ObjectId(parsed.data.patientId) as PatientId,
    createdAt: new Date(createdAt),
    consentedAt: new Date(consentedAt),
    expiresAt: new Date(expiresAt),
  };
}

const upstreamPersonSchema = z.object({
  _id: z.string().regex(/^[0-9a-f]{24}$/),
  patientId: z.string().regex(/^[0-9a-f]{24}$/),
  name: z.string(),
  relation: z.string().nullable(),
  referenceImageKeys: z.array(z.string()),
  embeddingModel: z.string(),
  consentedAt: z.string(),
  consentedBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
