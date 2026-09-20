import "server-only";
import { tenantRepos, type Db, type NotificationDoc, type PatientId } from "@memory-glasses/db";
import type { PushPayload } from "@memory-glasses/shared";
import { after } from "next/server";
import webPush, { WebPushError } from "web-push";
import { optionalEnv } from "./env";

export type { PushPayload };

export type PushReport = {
  /** Subscriptions the push service accepted. */
  sent: number;
  /** Subscriptions the push service said are gone (404/410), now deleted. */
  expired: number;
  /** Subscriptions that failed for any other reason; they stay for the next alert. */
  failed: number;
  /** False when VAPID isn't configured; nothing was attempted. */
  configured: boolean;
};

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** VAPID from env, or null when any of the three is unset. */
export function vapidConfig(): VapidConfig | null {
  const publicKey = optionalEnv("VAPID_PUBLIC_KEY");
  const privateKey = optionalEnv("VAPID_PRIVATE_KEY");
  const subject = optionalEnv("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

// Notifications already pushed by this process. The perception service inserts
// danger_alert rows itself, so the web app first meets them in the HUD poll,
// which repeats every two seconds until the device marks them shown.
const PUSHED_TTL_MS = 60 * 60 * 1000;
const pushed = new Map<string, number>();

function firstSight(notificationId: string, now = Date.now()): boolean {
  for (const [id, at] of pushed) if (now - at > PUSHED_TTL_MS) pushed.delete(id);
  if (pushed.has(notificationId)) return false;
  pushed.set(notificationId, now);
  return true;
}

// Keyed by string: `lost_alert` joins notificationKind with the lost-alert work.
const ALERT_TITLES: Record<string, string> = {
  danger_alert: "Possible danger",
  lost_alert: "Out of the approved area",
};

/**
 * The hook for alert-like notifications: pushes a `danger_alert` or `lost_alert`
 * once per notification per process, and ignores every other kind. Call it
 * wherever such a notification is created or first observed.
 */
export function pushAlertNotification(db: Db, notification: NotificationDoc): boolean {
  const title = ALERT_TITLES[notification.kind];
  if (!title) return false;
  const id = notification._id.toHexString();
  if (!firstSight(id)) return false;
  const send = () =>
    pushToCaregivers(db, notification.patientId, {
      title,
      body: notification.text,
      // The alerts tab takes over this URL once it exists.
      url: "/dashboard",
      tag: `${notification.kind}-${id}`,
    });
  // After the response on Vercel, so the function isn't frozen mid-send. Outside
  // a request (tests, scripts) `after` throws, and the send just runs detached.
  try {
    after(send);
  } catch {
    void send();
  }
  return true;
}

/** A push the receiving service worker won't hold for long: alerts are for now. */
const PUSH_TTL_SECONDS = 10 * 60;

export type SendPush = typeof webPush.sendNotification;

/**
 * Sends `payload` to every Web Push subscription of `patientId`'s caregivers.
 * The call site for `danger_alert` and `lost_alert`: fire and forget, it never
 * throws. A push service answering 404 or 410 means the browser unsubscribed,
 * and that subscription is deleted; other failures are logged and kept.
 *
 *   await pushToCaregivers(getDb(), patientId, {
 *     title: "Possible danger",
 *     body: notification.text,
 *     url: "/dashboard",
 *     tag: `danger-${notification._id.toHexString()}`,
 *   });
 */
export async function pushToCaregivers(
  db: Db,
  patientId: PatientId,
  payload: PushPayload,
  send: SendPush = webPush.sendNotification,
): Promise<PushReport> {
  const report: PushReport = { sent: 0, expired: 0, failed: 0, configured: false };
  try {
    const vapid = vapidConfig();
    if (!vapid) {
      console.warn("Web Push skipped: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are not all set");
      return report;
    }
    report.configured = true;
    const repo = tenantRepos(db, patientId).pushSubscriptions;
    const subscriptions = await repo.listForPatient();
    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await send(
            { endpoint: subscription.endpoint, keys: subscription.keys },
            body,
            {
              TTL: PUSH_TTL_SECONDS,
              urgency: "high",
              topic: payload.tag?.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "-"),
              vapidDetails: vapid,
            },
          );
          report.sent += 1;
          await repo.markUsed(subscription._id);
        } catch (error) {
          if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
            report.expired += 1;
            await repo.deleteByEndpoint(subscription.endpoint);
            return;
          }
          report.failed += 1;
          console.error(`Web Push to ${subscription.endpoint.slice(0, 60)}... failed`, error);
        }
      }),
    );
  } catch (error) {
    console.error("Web Push fan-out failed", error);
  }
  return report;
}
