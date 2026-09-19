import { z } from "zod";
import { idSchema, type CaregiverId, type NotificationId, type PatientId } from "../ids";
import { notificationKind, notificationStatus } from "./common";

/**
 * A caregiver message or reminder waiting for the HUD. Optional after M3.
 * Captions and sighting notifications never land here; the client builds those.
 */
export const notificationDocSchema = z.strictObject({
  _id: idSchema<NotificationId>(),
  patientId: idSchema<PatientId>(),
  kind: notificationKind,
  text: z.string().trim().min(1).max(200),
  createdBy: idSchema<CaregiverId>().nullable(),
  /** When it becomes due. A message is due as soon as it's sent. */
  showAt: z.date(),
  status: notificationStatus,
  shownAt: z.date().nullable(),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type NotificationDoc = z.infer<typeof notificationDocSchema>;
