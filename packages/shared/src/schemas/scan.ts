import { z } from "zod";

/** The bundled demo room under apps/web/public/scan/room. Live scenes use splat-slam scene ids. */
export const STATIC_SCAN_SCENE_ID = "room-demo";

const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/);
const isoTimestamp = z.string().datetime({ offset: true });
const unit = z.number().min(0).max(1);
const sceneId = z.string().min(1).max(100);
const frameName = z.string().min(1).max(200);

/** [x, y, z]. The demo room uses the mesh GLB's frame, y up; live scenes use splat-slam world coordinates. */
export const scanVec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** Where a detection sat in one kept frame: the bbox centre, as fractions of the frame. */
export const scanObservationSchema = z.object({ frame: frameName, u: unit, v: unit });

export const scanPinSourceSchema = z.enum(["manual", "slam", "seed"]);

/** One item's last known spot in one scene. `position` is null until the observed frame has a pose. */
export const scanPinSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  sceneId,
  position: scanVec3Schema.nullable(),
  observation: scanObservationSchema.nullable(),
  source: scanPinSourceSchema,
  seenAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

// patientId comes from the session, never the request body.
export const putScanPinBodySchema = z
  .object({
    itemId: objectIdHex,
    sceneId,
    position: scanVec3Schema,
    source: z.enum(["manual", "slam"]),
    /** The frame this position was solved from. The write is dropped when a newer frame has replaced it. */
    frame: frameName.optional(),
  })
  .strict();

export const postScanObservationsBodySchema = z
  .object({
    sceneId,
    /** The `name` splat-slam returned for the kept frame, the same string as cameras[].file. */
    frame: frameName,
    seenAt: isoTimestamp.optional(),
    observations: z
      .array(z.object({ itemId: objectIdHex, u: unit, v: unit }).strict())
      .min(1)
      .max(20),
  })
  .strict();

/** GET /api/scan/live. `scene` is splat-slam's scene state, passed through as it sent it. */
export const scanLiveStateSchema = z.object({
  configured: z.boolean(),
  reachable: z.boolean(),
  sceneId: z.string().nullable(),
  scene: z.object({}).passthrough().nullable(),
});

export const scanFrameResultSchema = z.object({
  sceneId: z.string(),
  kept: z.boolean(),
  reason: z.string(),
  name: z.string().nullable(),
});

export type ScanVec3 = z.infer<typeof scanVec3Schema>;
export type ScanObservation = z.infer<typeof scanObservationSchema>;
export type ScanPinSource = z.infer<typeof scanPinSourceSchema>;
export type ScanPin = z.infer<typeof scanPinSchema>;
export type PutScanPinBody = z.infer<typeof putScanPinBodySchema>;
export type PostScanObservationsBody = z.infer<typeof postScanObservationsBodySchema>;
export type ScanLiveState = z.infer<typeof scanLiveStateSchema>;
export type ScanFrameResult = z.infer<typeof scanFrameResultSchema>;
