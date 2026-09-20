import { z } from "zod";
import {
  idSchema,
  type CaptureSessionId,
  type DeviceId,
  type FrameObservationId,
  type NotificationId,
  type PatientId,
  type PersonId,
} from "../ids";
import { bbox, objectKey, shortText, unitInterval } from "./common";

export const personDocSchema = z.strictObject({
  _id: idSchema<PersonId>(),
  patientId: idSchema<PatientId>(),
  name: shortText,
  relation: shortText.nullable(),
  referenceImageKeys: z.array(objectKey).max(20),
  /** Fernet ciphertext, one per reference photo. Never returned by any API. */
  faceEmbeddings: z.array(z.string().min(1).max(20000)).max(20),
  embeddingModel: z.string().min(1).max(100),
  consentedAt: z.date(),
  consentedBy: z.string().trim().min(1).max(120),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export const faceObservationSchema = z.strictObject({
  bbox,
  confidence: unitInterval,
  personId: idSchema<PersonId>().nullable(),
  matchConfidence: unitInterval.nullable(),
});

export const frameObservationDocSchema = z.strictObject({
  _id: idSchema<FrameObservationId>(),
  patientId: idSchema<PatientId>(),
  deviceId: idSchema<DeviceId>().nullable(),
  captureSessionId: idSchema<CaptureSessionId>().nullable(),
  capturedAt: z.date(),
  imageKey: objectKey,
  imageWidth: z.int().positive(),
  imageHeight: z.int().positive(),
  faces: z.array(faceObservationSchema).max(50),
  processing: z.strictObject({
    status: z.enum(["complete", "failed"]),
    failedStage: z.string().max(60).nullable(),
    error: z.string().max(1000).nullable(),
    durationMs: z.int().nonnegative(),
  }),
  expiresAt: z.date(),
});

export type PersonDoc = z.infer<typeof personDocSchema>;
export type FrameObservationDoc = z.infer<typeof frameObservationDocSchema>;
