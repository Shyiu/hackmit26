import { z } from "zod";
import { idSchema, type PatientId, type RoomId, type RoomRefId } from "../ids";
import { embedding, objectKey, shortText, timestamps } from "./common";
import { lookupKey } from "./items";

/** A room the family named, "the den". Optional after M3. */
export const roomDocSchema = z.strictObject({
  _id: idSchema<RoomId>(),
  patientId: idSchema<PatientId>(),
  name: shortText,
  /** `name` run through normalizeLookupKey, so "The Den" and "the den" collide. */
  normalizedName: lookupKey,
  /** For the later on-device privacy gate. Not a server-side guarantee. */
  private: z.boolean(),
  ...timestamps,
});

export type RoomDoc = z.infer<typeof roomDocSchema>;

/** One reference frame's embedding for room classification. */
export const roomRefDocSchema = z.strictObject({
  _id: idSchema<RoomRefId>(),
  patientId: idSchema<PatientId>(),
  roomId: idSchema<RoomId>(),
  embedding,
  embeddingModel: z.string().min(1).max(100),
  imageKey: objectKey,
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type RoomRefDoc = z.infer<typeof roomRefDocSchema>;
