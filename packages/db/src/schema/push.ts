import { z } from "zod";
import { idSchema, type CaregiverId, type PatientId, type PushSubscriptionId } from "../ids";

/**
 * One browser's Web Push subscription for one caregiver, watching one wearer.
 * `danger_alert` and `lost_alert` notifications fan out to every subscription
 * of the wearer. A push service answering 404 or 410 deletes the document.
 */
export const pushSubscriptionDocSchema = z.strictObject({
  _id: idSchema<PushSubscriptionId>(),
  patientId: idSchema<PatientId>(),
  caregiverId: idSchema<CaregiverId>(),
  /** The push service URL. Unique: a browser re-subscribing updates in place. */
  endpoint: z.string().url().max(2000),
  keys: z.strictObject({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  userAgent: z.string().max(300).nullable(),
  createdAt: z.date(),
  /** Last successful send. */
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date(),
});

export type PushSubscriptionDoc = z.infer<typeof pushSubscriptionDocSchema>;
