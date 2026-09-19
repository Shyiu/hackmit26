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

const spokenNameSchema = z.string().trim().min(1).max(60);

// patientId comes from the session or device token, never the request body.
export const createItemSchema = z
  .object({
    name: spokenNameSchema,
    aliases: z.array(spokenNameSchema).max(20).default([]),
    detectorPrompts: z.array(spokenNameSchema).max(10).default([]),
    /** "they were" instead of "it was". Guessed from the name when left out. */
    plural: z.boolean().optional(),
  })
  .strict();

export const updateItemSchema = z
  .object({
    name: spokenNameSchema.optional(),
    aliases: z.array(spokenNameSchema).max(20).optional(),
    detectorPrompts: z.array(spokenNameSchema).max(10).optional(),
    plural: z.boolean().optional(),
    /** false archives the item: its history stays and its names free up. */
    active: z.boolean().optional(),
  })
  .strict();

export type ObservationState = z.infer<typeof observationStateSchema>;
export type DescriptionStatus = z.infer<typeof descriptionStatusSchema>;
export type SightingSummary = z.infer<typeof sightingSummarySchema>;
export type UsualSpot = z.infer<typeof usualSpotSchema>;
export type Item = z.infer<typeof itemSchema>;
export type CreateItem = z.infer<typeof createItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;
