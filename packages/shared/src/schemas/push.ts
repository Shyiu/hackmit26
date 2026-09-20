import { z } from "zod";

// A browser PushSubscription as `subscription.toJSON()` hands it over, sent by
// the caregiver's dashboard to POST /api/push/subscribe. patientId and the
// caregiver come from the session, never the body.
export const pushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2000),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(200),
        auth: z.string().min(1).max(100),
      })
      .strict(),
  })
  .strict();

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) }).strict();

/** What a service worker receives as the push payload. */
export const pushPayloadSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(300),
  /** Where clicking the notification takes the caregiver. Same-origin path. */
  url: z.string().max(500),
  /** Notifications with the same tag replace each other. */
  tag: z.string().max(100).optional(),
});

export type PushSubscribe = z.infer<typeof pushSubscribeSchema>;
export type PushUnsubscribe = z.infer<typeof pushUnsubscribeSchema>;
export type PushPayload = z.infer<typeof pushPayloadSchema>;
