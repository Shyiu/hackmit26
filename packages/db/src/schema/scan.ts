import { scanPinSourceSchema } from "@memory-glasses/shared";
import { z } from "zod";
import { idSchema, type ItemId, type PatientId, type ScanPinId } from "../ids";
import { unitInterval } from "./common";

export const scanPinSource = z.enum(scanPinSourceSchema.options);

/** [x, y, z]. The demo room uses the mesh GLB's frame, y up; live scenes use splat-slam world coordinates. */
export const scanPosition = z.tuple([z.number(), z.number(), z.number()]);

/** The kept frame a detection came from, and the bbox centre in it as fractions of the frame. */
export const scanObservation = z.strictObject({
  frame: z.string().min(1).max(200),
  u: unitInterval,
  v: unitInterval,
});

/**
 * Where one item was last seen in one 3D scene. No `expiresAt`: a pin is a
 * single overwritten spot, not history, so it lives as long as its item.
 */
export const scanPinDocSchema = z.strictObject({
  _id: idSchema<ScanPinId>(),
  patientId: idSchema<PatientId>(),
  itemId: idSchema<ItemId>(),
  /** "room-demo" for the bundled room, else a splat-slam scene id. */
  sceneId: z.string().min(1).max(100),
  /** Null while `observation.frame` has no camera pose yet. */
  position: scanPosition.nullable(),
  observation: scanObservation.nullable(),
  /** Who placed `position`. */
  source: scanPinSource,
  seenAt: z.date(),
  updatedAt: z.date(),
});

export type ScanPinSource = z.infer<typeof scanPinSource>;
export type ScanPinDoc = z.infer<typeof scanPinDocSchema>;
