import { z } from "zod";

export const observationStateSchema = z.enum([
  "resting",
  "held",
  "moving",
  "in_use",
  "unknown",
]);

export const descriptionStatusSchema = z.enum(["pending", "ready", "failed"]);

export const sightingSummarySchema = z.object({
  sightingId: z.string(),
  observationVersion: z.number().int(),
  keyframeRevision: z.number().int(),
  sentence: z.string().optional(),
  room: z.string().optional(),
  state: observationStateSchema,
  lastSeenAt: z.coerce.date(),
  thumbKey: z.string().optional(),
  descriptionStatus: descriptionStatusSchema,
});

export const usualSpotSchema = z.object({
  sentence: z.string(),
  share: z.number().min(0).max(1),
});

export const itemSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  detectorPrompts: z.array(z.string()).default([]),
  referenceImages: z.array(z.string()).default([]),
  nameEmbedding: z.array(z.number()).length(1536).optional(),
  lastSighting: sightingSummarySchema.optional(),
  lastRestingSighting: sightingSummarySchema.optional(),
  locationStatus: z.enum(["observed", "moved", "uncertain"]).optional(),
  usualSpots: z.array(usualSpotSchema).default([]),
});

export const createItemSchema = itemSchema.pick({
  patientId: true,
  name: true,
  aliases: true,
  detectorPrompts: true,
});

export type ObservationState = z.infer<typeof observationStateSchema>;
export type DescriptionStatus = z.infer<typeof descriptionStatusSchema>;
export type SightingSummary = z.infer<typeof sightingSummarySchema>;
export type UsualSpot = z.infer<typeof usualSpotSchema>;
export type Item = z.infer<typeof itemSchema>;
export type CreateItem = z.infer<typeof createItemSchema>;
