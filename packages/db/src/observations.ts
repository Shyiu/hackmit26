import type { Db } from "mongodb";
import { parseDocument } from "./errors";
import {
  newId,
  type CaptureSessionId,
  type FrameObservationId,
  type ItemId,
  type PatientId,
  type PersonId,
  type SightingId,
} from "./ids";
import { collection } from "./registry";
import type { CaptureSource, ObservationState } from "./schema/common";
import type { SightingSnapshot } from "./schema/items";
import {
  frameObservationDocSchema,
  personDocSchema,
  type FrameObservationDoc,
  type PersonDoc,
} from "./schema/safety";
import { sightingDocSchema, type SightingDoc } from "./schema/sightings";
import { DEFAULT_PATIENT_SETTINGS } from "./schema/tenancy";

/** The snapshot an item carries for a sighting. Perception's store.py builds the same shape. */
export function snapshotOf(sighting: SightingDoc): SightingSnapshot {
  return {
    sightingId: sighting._id,
    observationVersion: sighting.observationVersion,
    keyframeRevision: sighting.keyframeRevision,
    state: sighting.state,
    descriptionStatus: sighting.descriptionStatus,
    sentence: sighting.sentence,
    room: sighting.room?.name ?? null,
    lastSeenAt: sighting.lastSeenAt,
    expiresAt: sighting.expiresAt,
    thumbKey: sighting.thumbKey,
    source: sighting.source,
  };
}

export type SeedObservation = {
  patientId: PatientId;
  itemId: ItemId;
  label: string;
  sessionId?: CaptureSessionId;
  source?: CaptureSource;
  lastSeenAt: Date;
  state: ObservationState;
  description:
    | { status: "pending" | "failed" }
    | { status: "ready"; sentence: string; room: string | null; surface?: string; relation?: string };
  retentionDays?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Writes one closed sighting and installs it as the item's snapshot, the state
 * perception leaves behind after a confirmed sighting and a finished
 * description. For seeds and tests only. The live path, with its version and
 * ordering guards, is services/perception/app/store.py.
 */
export async function seedObservation(
  db: Db,
  input: SeedObservation,
): Promise<{ sighting: SightingDoc; snapshot: SightingSnapshot }> {
  const items = collection(db, "items");
  const item = await items.findOneAndUpdate(
    { _id: input.itemId, patientId: input.patientId },
    { $inc: { observationVersion: 1 } },
    { returnDocument: "after" },
  );
  if (!item) throw new Error(`No item ${input.itemId.toHexString()} for that wearer`);

  const ready = input.description.status === "ready" ? input.description : null;
  const retentionMs = (input.retentionDays ?? DEFAULT_PATIENT_SETTINGS.retentionDays) * DAY_MS;
  const sighting = parseDocument(sightingDocSchema, {
    _id: newId<SightingId>(),
    patientId: input.patientId,
    itemId: input.itemId,
    label: input.label,
    status: "closed",
    sessionId: input.sessionId ?? newId<CaptureSessionId>(),
    deviceId: null,
    source: input.source ?? "simulator",
    eventId: `seed-${newId().toHexString()}`,
    firstSeenAt: new Date(input.lastSeenAt.getTime() - 5_000),
    lastSeenAt: input.lastSeenAt,
    closedAt: new Date(input.lastSeenAt.getTime() + 3_000),
    expiresAt: new Date(input.lastSeenAt.getTime() + retentionMs),
    firstSeq: 0,
    lastSeq: 12,
    observationVersion: item.observationVersion,
    keyframeRevision: 1,
    keyframeKey: null,
    thumbKey: null,
    confidence: 0.9,
    bbox: [0.42, 0.55, 0.08, 0.06],
    frameSize: [1280, 720],
    state: input.state,
    descriptionStatus: input.description.status,
    room: ready?.room ? { id: null, name: ready.room, confidence: 0.9 } : null,
    surface: ready?.surface ?? null,
    relation: ready?.relation ?? null,
    sentence: ready?.sentence ?? null,
    nearbyObjects: [],
  });
  await collection(db, "sightings").insertOne(sighting);

  const snapshot = snapshotOf(sighting);
  await items.updateOne(
    { _id: input.itemId, patientId: input.patientId },
    {
      $set: {
        lastSighting: snapshot,
        ...(input.state === "resting" && { lastRestingSighting: snapshot }),
      },
    },
  );
  return { sighting, snapshot };
}

export type SeedPerson = {
  patientId: PatientId;
  name: string;
  relation?: string | null;
  photos?: number;
  createdAt?: Date;
  retentionDays?: number;
};

/** Writes one enrolled person the way perception's safety/store.py leaves them. For seeds and tests only. */
export async function seedPerson(db: Db, input: SeedPerson): Promise<PersonDoc> {
  const createdAt = input.createdAt ?? new Date();
  const retentionMs = (input.retentionDays ?? DEFAULT_PATIENT_SETTINGS.retentionDays) * DAY_MS;
  const photos = input.photos ?? 1;
  const person = parseDocument(personDocSchema, {
    _id: newId<PersonId>(),
    patientId: input.patientId,
    name: input.name,
    relation: input.relation ?? null,
    referenceImageKeys: Array.from({ length: photos }, (_, i) => `seed/people/${newId().toHexString()}-${i}.jpg`),
    faceEmbeddings: Array.from({ length: photos }, () => "gAAAAABseed"),
    embeddingModel: "seed",
    consentedAt: createdAt,
    consentedBy: "seed",
    createdAt,
    expiresAt: new Date(createdAt.getTime() + retentionMs),
  });
  await collection(db, "people").insertOne(person);
  return person;
}

export type SeedFrameObservation = {
  patientId: PatientId;
  capturedAt: Date;
  faces?: { personId: PersonId | null; matchConfidence: number | null }[];
  retentionDays?: number;
};

/** Writes one processed frame with the given face matches. For seeds and tests only. */
export async function seedFrameObservation(db: Db, input: SeedFrameObservation): Promise<FrameObservationDoc> {
  const retentionMs = (input.retentionDays ?? DEFAULT_PATIENT_SETTINGS.retentionDays) * DAY_MS;
  const frame = parseDocument(frameObservationDocSchema, {
    _id: newId<FrameObservationId>(),
    patientId: input.patientId,
    deviceId: null,
    captureSessionId: null,
    capturedAt: input.capturedAt,
    imageKey: `seed/frames/${newId().toHexString()}.jpg`,
    imageWidth: 1280,
    imageHeight: 720,
    faces: (input.faces ?? []).map((face) => ({ bbox: [0.4, 0.3, 0.2, 0.3], confidence: 0.9, ...face })),
    processing: { status: "complete", failedStage: null, error: null, durationMs: 40 },
    expiresAt: new Date(input.capturedAt.getTime() + retentionMs),
  });
  await collection(db, "frameObservations").insertOne(frame);
  return frame;
}
