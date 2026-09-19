import { z } from "zod";

// Headset recordings that have left the phone. Optional, after M3: in the MVP a
// recording is a file on the phone and never reaches this collection.
export const recordingChunkSchema = z.object({
  seq: z.number().int().nonnegative(),
  startedAt: z.coerce.date(),
  durationMs: z.number().nonnegative(),
  key: z.string(),
  bytes: z.number().int().nonnegative(),
});

export const recordingSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  sessionId: z.string(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date(),
  mimeType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  hasAudio: z.boolean().default(false),
  chunks: z.array(recordingChunkSchema).default([]),
});

export const createRecordingSchema = recordingSchema.pick({
  sessionId: true,
  startedAt: true,
  mimeType: true,
  width: true,
  height: true,
  hasAudio: true,
});

// The server assigns the storage key and answers with a signed upload URL.
// `final` marks the last chunk; the recording's `endedAt` comes from it.
export const createRecordingChunkSchema = recordingChunkSchema.omit({ key: true }).extend({
  final: z.boolean().optional(),
});

export const recordingChunkUploadSchema = z.object({
  recordingId: z.string(),
  seq: z.number().int().nonnegative(),
  key: z.string(),
  /** Signed PUT URL for the chunk body, `content-type` set to the recording's mime type. */
  uploadUrl: z.string().url(),
  expiresAt: z.coerce.date(),
});

export type RecordingChunk = z.infer<typeof recordingChunkSchema>;
export type Recording = z.infer<typeof recordingSchema>;
export type CreateRecording = z.infer<typeof createRecordingSchema>;
export type CreateRecordingChunk = z.infer<typeof createRecordingChunkSchema>;
export type RecordingChunkUpload = z.infer<typeof recordingChunkUploadSchema>;
