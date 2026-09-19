import type { NotificationId } from "@memory-glasses/db";
import { readId, withTenant } from "@/lib/server/api";
import { notificationView } from "@/lib/server/views";

// Marks a notification shown once the HUD has displayed and spoken it. Until then
// it stays queued, so one dropped behind an answer comes back on the next poll.
// Marking it twice is harmless and returns null the second time.
export const POST = withTenant<{ id: string }>("any", async ({ params, tenant }) => {
  const shown = await tenant.notifications.markShown(readId<NotificationId>(params.id));
  return Response.json({ notification: shown && notificationView(shown) });
});
