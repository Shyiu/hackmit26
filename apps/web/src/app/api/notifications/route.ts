import { createNotificationSchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { pushAlertNotification } from "@/lib/server/push";
import { notificationView } from "@/lib/server/views";

// Optional, after M3. GET: the headset polls for the one message or reminder it
// should show next. POST: the caregiver queues one. See README "What the HUD shows".
// A danger_alert the perception service queued gets its Web Push the first time
// the poll sees it (pushAlertNotification dedups by id); the poll doesn't wait.
export const GET = withTenant("any", async ({ tenant }) => {
  const next = await tenant.notifications.nextDue();
  if (next) pushAlertNotification(getDb(), next);
  return Response.json({ notification: next && notificationView(next) });
});

export const POST = withTenant("caregiver", async ({ request, principal, tenant }) => {
  const input = await readBody(request, createNotificationSchema);
  const notification = await tenant.notifications.create({
    ...input,
    createdBy: principal.kind === "caregiver" ? principal.caregiverId : null,
  });
  pushAlertNotification(getDb(), notification);
  return Response.json(notificationView(notification), { status: 201 });
});
