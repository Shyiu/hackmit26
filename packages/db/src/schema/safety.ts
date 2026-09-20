import { z } from "zod";
import {
  idSchema,
  type CaptureSessionId,
  type DangerEventId,
  type DeviceId,
  type FrameObservationId,
  type NotificationId,
  type PatientId,
  type PersonId,
} from "../ids";
import { bbox, frameSize, objectKey, sentenceText, shortText, unitInterval } from "./common";

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

export const detectionSchema = z.strictObject({
  label: shortText,
  confidence: unitInterval,
  bbox,
});

export const faceObservationSchema = z.strictObject({
  bbox,
  confidence: unitInterval,
  personId: idSchema<PersonId>().nullable(),
  matchConfidence: unitInterval.nullable(),
});

export const vlmStatus = z.enum(["skipped", "confirmed", "rejected", "failed"]);

export const frameObservationDocSchema = z.strictObject({
  _id: idSchema<FrameObservationId>(),
  patientId: idSchema<PatientId>(),
  deviceId: idSchema<DeviceId>().nullable(),
  captureSessionId: idSchema<CaptureSessionId>().nullable(),
  capturedAt: z.date(),
  imageKey: objectKey,
  imageWidth: z.int().positive(),
  imageHeight: z.int().positive(),
  caption: sentenceText.nullable(),
  detections: z.array(detectionSchema).max(100),
  faces: z.array(faceObservationSchema).max(50),
  hazards: z.array(detectionSchema).max(100),
  vlm: z.strictObject({
    status: vlmStatus,
    model: z.string().max(100).nullable(),
    confidence: unitInterval.nullable(),
    observableEvidence: z.array(z.string().max(300)).max(20),
    error: z.string().max(1000).nullable(),
  }),
  processing: z.strictObject({
    status: z.enum(["complete", "failed"]),
    failedStage: z.string().max(60).nullable(),
    error: z.string().max(1000).nullable(),
    durationMs: z.int().nonnegative(),
  }),
  detectorName: z.string().min(1).max(100),
  expiresAt: z.date(),
});

export const dangerKind = z.enum([
  "unknown_face",
  "weapon_visible",
  "medication_or_chemical_visible",
  "hot_surface_visible",
  "hazard_visible",
]);
export const dangerSeverity = z.enum(["low", "medium", "high"]);
export const dangerVerification = z.enum(["unverified", "model_confirmed", "model_rejected"]);
export const evidenceScope = z.enum(["single_frame", "temporal"]);
export const dangerStatus = z.enum(["open", "acknowledged", "dismissed", "escalated", "closed"]);

export const dangerEventDocSchema = z.strictObject({
  _id: idSchema<DangerEventId>(),
  patientId: idSchema<PatientId>(),
  kind: dangerKind,
  hazardLabel: shortText.nullable(),
  severity: dangerSeverity,
  confidence: unitInterval,
  verification: dangerVerification,
  evidenceScope,
  status: dangerStatus,
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  bbox,
  frameSize,
  keyframeKey: objectKey,
  frameObservationIds: z.array(idSchema<FrameObservationId>()).max(200),
  evidence: z.strictObject({
    detectorName: z.string().min(1).max(100),
    detectorConfidence: unitInterval,
    vlmModel: z.string().max(100).nullable(),
    vlmConfidence: unitInterval.nullable(),
    observableEvidence: z.array(z.string().max(300)).max(20),
  }),
  acknowledgedAt: z.date().nullable(),
  acknowledgedBy: z.string().trim().min(1).max(120).nullable(),
  notification: z.strictObject({
    status: z.enum(["pending", "queued", "failed"]),
    notificationId: idSchema<NotificationId>().nullable(),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
  expiresAt: z.date(),
});

export type PersonDoc = z.infer<typeof personDocSchema>;
export type FrameObservationDoc = z.infer<typeof frameObservationDocSchema>;
export type DangerEventDoc = z.infer<typeof dangerEventDocSchema>;
