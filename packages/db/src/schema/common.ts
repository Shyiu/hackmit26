import {
  descriptionStatusSchema,
  interactionSchema,
  interactionStatusSchema,
  notificationKindSchema,
  notificationStatusSchema,
  observationStateSchema,
  playbackReportSchema,
  sightingSchema,
} from "@memory-glasses/shared";
import { z } from "zod";

// Enum values come from the wire contract in @memory-glasses/shared, so each
// concept has one list. Shared is still on zod 3, so only the values cross over.
export const observationState = z.enum(observationStateSchema.options);
export const descriptionStatus = z.enum(descriptionStatusSchema.options);
export const sightingStatus = z.enum(sightingSchema.shape.status.options);
export const captureSource = z.enum(sightingSchema.shape.source.options);
export const interactionStatus = z.enum(interactionStatusSchema.options);
export const answerPath = z.enum(interactionSchema.shape.path.unwrap().options);
export const playbackOutcome = z.enum(playbackReportSchema.shape.outcome.options);
export const notificationKind = z.enum(notificationKindSchema.options);
export const notificationStatus = z.enum(notificationStatusSchema.options);

export type ObservationState = z.infer<typeof observationState>;
export type DescriptionStatus = z.infer<typeof descriptionStatus>;
export type CaptureSource = z.infer<typeof captureSource>;
export type InteractionStatus = z.infer<typeof interactionStatus>;

/** A fraction of the frame, 0 to 1. */
export const unitInterval = z.number().min(0).max(1);

/** [x, y, w, h] normalized to the frame, the same convention the HUD draws with. */
export const bbox = z.tuple([unitInterval, unitInterval, unitInterval, unitInterval]);

/** [width, height] in pixels of the frame the box came from. */
export const frameSize = z.tuple([z.int().positive(), z.int().positive()]);

// Bounds on free text keep a runaway model reply or a bad client from filling
// the 512 MB free cluster.
export const shortText = z.string().trim().min(1).max(60);
export const sentenceText = z.string().trim().min(1).max(300);
export const objectKey = z.string().min(1).max(300);

/** Dense vector. The index definition, not this schema, pins the dimension count. */
export const embedding = z.array(z.number()).min(1).max(4096);

export const timestamps = {
  createdAt: z.date(),
  updatedAt: z.date(),
};
