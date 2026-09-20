import { createNotificationSchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";
import { notificationView } from "@/lib/server/views";
import { fireDueRoutines } from "@/lib/server/routines";

// Optional, after M3. GET: the headset polls for the one message or reminder it
// should show next. POST: the caregiver queues one. See README "What the HUD shows".
export const GET = withTenant("any", async ({ tenant, settings }) => {
  try {
    await fireDueRoutines(tenant, settings.timezone);
  } catch (error) {
    console.error("Failed to fire routines", error);
  }
  const next = await tenant.notifications.nextDue();
  return Response.json({ notification: next && notificationView(next) });
});

export const POST = withTenant("caregiver", async ({ request, principal, tenant }) => {
  const input = await readBody(request, createNotificationSchema);
  const notification = await tenant.notifications.create({
    ...input,
    createdBy: principal.kind === "caregiver" ? principal.caregiverId : null,
  });
  return Response.json(notificationView(notification), { status: 201 });
});
