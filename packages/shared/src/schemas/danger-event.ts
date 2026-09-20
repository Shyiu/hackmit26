import { z } from "zod";

// Hazard events perception raises for the caregiver's Alerts tab. Read-only over
// the API apart from acknowledging; patientId comes from the session.
export const dangerKindSchema = z.enum([
  "unknown_face",
  "weapon_visible",
  "medication_or_chemical_visible",
  "hot_surface_visible",
  "hazard_visible",
]);
export const dangerSeveritySchema = z.enum(["low", "medium", "high"]);
export const dangerVerificationSchema = z.enum(["unverified", "model_confirmed", "model_rejected"]);
export const dangerStatusSchema = z.enum(["open", "acknowledged", "dismissed", "escalated", "closed"]);

/** `GET /api/danger-events?status=open&limit=50` */
export const listDangerEventsQuerySchema = z
  .object({
    status: dangerStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type DangerKind = z.infer<typeof dangerKindSchema>;
export type DangerSeverity = z.infer<typeof dangerSeveritySchema>;
export type DangerVerification = z.infer<typeof dangerVerificationSchema>;
export type DangerStatus = z.infer<typeof dangerStatusSchema>;
export type ListDangerEventsQuery = z.infer<typeof listDangerEventsQuerySchema>;
