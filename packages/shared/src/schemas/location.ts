import { z } from "zod";

export const reportLocationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().nullable().optional(),
    capturedAt: z.string().datetime({ offset: true }).pipe(z.coerce.date()),
  })
  .strict();

export type ReportLocation = z.infer<typeof reportLocationSchema>;
