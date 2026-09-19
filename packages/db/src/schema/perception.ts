import { z } from "zod";
import {
  idSchema,
  type CaptureSessionId,
  type DescriptionJobId,
  type DeviceId,
  type ItemId,
  type PatientId,
  type SightingId,
} from "../ids";
import { bbox, captureSource, objectKey } from "./common";

export const captureState = z.enum(["paused", "live", "ended"]);

/**
 * One frame socket connection. Perception opens it paused and the wearer has to
 * resume it; the dashboard reads the latest one for the capture status badge.
 */
export const captureSessionDocSchema = z.strictObject({
  _id: idSchema<CaptureSessionId>(),
  patientId: idSchema<PatientId>(),
  deviceId: idSchema<DeviceId>().nullable(),
  source: captureSource,
  state: captureState,
  startedAt: z.date(),
  updatedAt: z.date(),
  endedAt: z.date().nullable(),
  lastFrameAt: z.date().nullable(),
  lastSeq: z.int().nonnegative(),
  framesReceived: z.int().nonnegative(),
  framesDropped: z.int().nonnegative(),
  expiresAt: z.date(),
});

export type CaptureSessionDoc = z.infer<typeof captureSessionDocSchema>;

export const descriptionJobStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "superseded",
  "cancelled",
]);

export type DescriptionJobStatus = z.infer<typeof descriptionJobStatus>;

/**
 * A keyframe waiting for the vision model. The queue lives in MongoDB so the
 * perception worker needs no other service. A newer keyframe for the same
 * sighting supersedes a queued one.
 */
export const descriptionJobDocSchema = z.strictObject({
  _id: idSchema<DescriptionJobId>(),
  patientId: idSchema<PatientId>(),
  itemId: idSchema<ItemId>(),
  sightingId: idSchema<SightingId>(),
  /** The result touches the item snapshot only while the item is still at this version. */
  observationVersion: z.int().nonnegative(),
  keyframeRevision: z.int().nonnegative(),
  keyframeKey: objectKey,
  bbox,
  status: descriptionJobStatus,
  /** Also the fencing token: a worker can only finish the attempt it claimed. */
  attempts: z.int().nonnegative(),
  maxAttempts: z.int().positive().max(10),
  /** Queued: earliest start, pushed back on retry. Running: when the lease runs out. */
  runAfter: z.date(),
  leaseOwner: z.string().min(1).max(100).nullable(),
  lastError: z.string().max(1000).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  finishedAt: z.date().nullable(),
  expiresAt: z.date(),
});

export type DescriptionJobDoc = z.infer<typeof descriptionJobDocSchema>;
