import { z } from "zod";

// What the perception service sends back on /ws/frames for each frame, so
// the chest phone can label items. Boxes are [x, y, w, h], normalized to the frame.
export const detectionSchema = z.object({
  itemId: z.string(),
  label: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  confidence: z.number().min(0).max(1),
});

export const frameDetectionsSchema = z.object({
  seq: z.number().int().nonnegative(),
  detections: z.array(detectionSchema),
});

export type Detection = z.infer<typeof detectionSchema>;
export type FrameDetections = z.infer<typeof frameDetectionsSchema>;
