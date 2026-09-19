import { z } from "zod";
import { idSchema, type DeviceId, type PatientId, type RecordingId } from "../ids";
import { objectKey } from "./common";

export const recordingChunkSchema = z.strictObject({
  seq: z.int().nonnegative(),
  startedAt: z.date(),
  durationMs: z.number().nonnegative(),
  key: objectKey,
  bytes: z.int().nonnegative(),
});

/**
 * A headset recording that left the phone. Optional after M3; in the MVP the
 * file stays on the phone and this collection stays empty.
 */
export const recordingDocSchema = z.strictObject({
  _id: idSchema<RecordingId>(),
  patientId: idSchema<PatientId>(),
  deviceId: idSchema<DeviceId>().nullable(),
  /** The phone's own recording session id. */
  sessionId: z.string().min(1).max(100),
  startedAt: z.date(),
  endedAt: z.date().nullable(),
  expiresAt: z.date(),
  mimeType: z.string().min(1).max(100),
  width: z.int().positive(),
  height: z.int().positive(),
  hasAudio: z.boolean(),
  /** A twenty-minute recording in ten-second chunks is 120 entries. */
  chunks: z.array(recordingChunkSchema).max(2000),
});

export type RecordingDoc = z.infer<typeof recordingDocSchema>;
export type RecordingChunk = z.infer<typeof recordingChunkSchema>;
