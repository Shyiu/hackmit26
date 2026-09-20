import { z } from "zod";

// Caregiver messages and reminders waiting for the headset HUD. Optional, after M3.
// Answer captions and sighting notifications are built on the client, not stored.
export const notificationKindSchema = z.enum(["caregiver_message", "reminder", "person_recognized"]);

export const notificationStatusSchema = z.enum(["queued", "shown", "expired"]);

export const notificationSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  kind: notificationKindSchema,
  text: z.string().min(1).max(200),
  showAt: z.coerce.date().optional(),
  status: notificationStatusSchema,
  shownAt: z.coerce.date().optional(),
});

// patientId comes from the caregiver session, never the request body. showAt
// takes an ISO timestamp only: z.coerce.date() would read null as 1970.
export const createNotificationSchema = notificationSchema
  .pick({ kind: true, text: true })
  .extend({ showAt: z.string().datetime({ offset: true }).pipe(z.coerce.date()).optional() })
  .strict();

// Alert and recognized-person kinds are written by the system, not a caregiver
// form, so the POST route accepts only the two human-authored kinds.
export const caregiverNotificationSchema = createNotificationSchema.extend({
  kind: z.enum(["caregiver_message", "reminder"]),
});

export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;
export type WearerNotification = z.infer<typeof notificationSchema>;
export type CreateNotification = z.infer<typeof createNotificationSchema>;
