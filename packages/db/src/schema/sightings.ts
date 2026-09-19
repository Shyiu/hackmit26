import { z } from "zod";
import {
  idSchema,
  type CaptureSessionId,
  type DeviceId,
  type ItemId,
  type PatientId,
  type RoomId,
  type SightingId,
} from "../ids";
import {
  bbox,
  captureSource,
  descriptionStatus,
  embedding,
  frameSize,
  objectKey,
  observationState,
  sentenceText,
  shortText,
  sightingStatus,
  unitInterval,
} from "./common";

export const sightingRoomSchema = z.strictObject({
  /** Set when the room matched an enrolled room, null when the model named a room type. */
  id: idSchema<RoomId>().nullable(),
  name: shortText,
  confidence: unitInterval.nullable(),
});

/**
 * One continuous period an item stayed in view. Perception owns these. A new
 * sighting starts when the surface, room, or motion state changes.
 */
export const sightingDocSchema = z.strictObject({
  _id: idSchema<SightingId>(),
  patientId: idSchema<PatientId>(),
  itemId: idSchema<ItemId>(),
  label: shortText,
  status: sightingStatus,
  sessionId: idSchema<CaptureSessionId>(),
  deviceId: idSchema<DeviceId>().nullable(),
  source: captureSource,
  /** Perception's idempotency key. Replaying an event can't create a second sighting. */
  eventId: z.string().min(1).max(100),
  /** Server-normalized capture times, never job completion times. */
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  closedAt: z.date().nullable(),
  expiresAt: z.date(),
  /** Frame sequence numbers within the capture session. */
  firstSeq: z.int().nonnegative(),
  lastSeq: z.int().nonnegative(),
  /** Item version this sighting installed as the snapshot. 0 if it never did. */
  observationVersion: z.int().nonnegative(),
  keyframeRevision: z.int().nonnegative(),
  keyframeKey: objectKey.nullable(),
  thumbKey: objectKey.nullable(),
  confidence: unitInterval,
  bbox,
  frameSize,
  state: observationState,
  descriptionStatus,
  room: sightingRoomSchema.nullable(),
  surface: shortText.nullable(),
  relation: z.string().trim().min(1).max(120).nullable(),
  sentence: sentenceText.nullable(),
  nearbyObjects: z.array(shortText).max(20),
  searchText: z.string().max(500).optional(),
  sentenceEmbedding: embedding.optional(),
  embeddingModel: z.string().min(1).max(100).optional(),
});

export type SightingDoc = z.infer<typeof sightingDocSchema>;
