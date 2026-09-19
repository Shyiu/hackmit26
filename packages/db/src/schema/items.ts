import { z } from "zod";
import { idSchema, type ItemId, type PatientId, type SightingId } from "../ids";
import { MAX_ALIASES, MAX_LOOKUP_KEY_WORDS } from "../lookup";
import {
  captureSource,
  descriptionStatus,
  embedding,
  objectKey,
  observationState,
  sentenceText,
  shortText,
  timestamps,
  unitInterval,
} from "./common";

/** A normalized spoken name: lowercase words joined by single spaces. See lookup.ts. */
export const lookupKey = z
  .string()
  .min(1)
  .max(60)
  .regex(new RegExp(`^\\S+(?: \\S+){0,${MAX_LOOKUP_KEY_WORDS - 1}}$`));

/**
 * The latest observation, copied onto the item so "where are my keys" is one
 * indexed read. Perception writes it; see services/perception/app/store.py for
 * the version rules. `expiresAt` rides along so reads can drop an expired
 * snapshot without looking up the sighting.
 */
export const sightingSnapshotSchema = z.strictObject({
  sightingId: idSchema<SightingId>(),
  /** The item's `observationVersion` when this snapshot was installed. */
  observationVersion: z.int().positive(),
  keyframeRevision: z.int().nonnegative(),
  state: observationState,
  descriptionStatus,
  sentence: sentenceText.nullable(),
  room: shortText.nullable(),
  lastSeenAt: z.date(),
  expiresAt: z.date(),
  thumbKey: objectKey.nullable(),
  source: captureSource,
});

export type SightingSnapshot = z.infer<typeof sightingSnapshotSchema>;

export const usualSpotSchema = z.strictObject({
  sentence: sentenceText,
  share: unitInterval,
  /** Placements behind `share`. Too few and the answer leaves the usual spot out. */
  samples: z.int().nonnegative(),
  source: z.enum(["configured", "history"]),
});

export const itemDocSchema = z.strictObject({
  _id: idSchema<ItemId>(),
  patientId: idSchema<PatientId>(),
  /** The family's word for it, spoken back to the wearer. */
  name: shortText,
  /** Picks "it was" or "they were". Keys and glasses are plural. */
  plural: z.boolean(),
  aliases: z.array(shortText).max(MAX_ALIASES),
  /**
   * `name` and `aliases`, normalized. A unique index makes every key point at one
   * active item per wearer, so the fast path never has to pick between two.
   */
  lookupKeys: z.array(lookupKey).min(1).max(MAX_ALIASES + 1),
  detectorPrompts: z.array(shortText).min(1).max(10),
  referenceImageKeys: z.array(objectKey).max(20),
  nameEmbedding: embedding.optional(),
  embeddingModel: z.string().min(1).max(100).optional(),
  /** Archived items keep their history and release their lookup keys. */
  active: z.boolean(),
  /** Counts snapshot replacements. Description results apply only if it hasn't moved. */
  observationVersion: z.int().nonnegative(),
  lastSighting: sightingSnapshotSchema.nullable(),
  /** The last place it sat still. History once newer held or moving evidence arrives. */
  lastRestingSighting: sightingSnapshotSchema.nullable(),
  usualSpots: z.array(usualSpotSchema).max(5),
  ...timestamps,
});

export type ItemDoc = z.infer<typeof itemDocSchema>;
