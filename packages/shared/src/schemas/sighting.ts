import { z } from "zod";
import { descriptionStatusSchema, observationStateSchema } from "./item";

export const roomRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  confidence: z.number().min(0).max(1),
});

export const sightingSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  itemId: z.string(),
  label: z.string(),
  status: z.enum(["open", "closed"]),
  firstSeenAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  sessionId: z.string(),
  eventId: z.string(),
  observationVersion: z.number().int(),
  keyframeRevision: z.number().int(),
  descriptionStatus: descriptionStatusSchema,
  confidence: z.number().min(0).max(1),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  frameSize: z.tuple([z.number(), z.number()]),
  room: roomRefSchema.optional(),
  surface: z.string().optional(),
  relation: z.string().optional(),
  state: observationStateSchema,
  sentence: z.string().optional(),
  nearbyObjects: z.array(z.string()).default([]),
  keyframeKey: z.string().optional(),
  thumbKey: z.string().optional(),
  searchText: z.string().optional(),
  sentenceEmbedding: z.array(z.number()).length(1536).optional(),
  embeddingModel: z.string().optional(),
  source: z.enum(["glasses", "simulator"]),
});

export type Sighting = z.infer<typeof sightingSchema>;
