import { listDangerEventsQuerySchema } from "@memory-glasses/shared";
import { readQuery, withTenant } from "@/lib/server/api";
import { dangerEventView } from "@/lib/server/views";

// Hazard events for the Alerts tab, newest first. `?status=open` narrows to
// the ones nobody has acknowledged yet.
export const GET = withTenant("caregiver", async ({ request, tenant }) => {
  const query = readQuery(request, listDangerEventsQuerySchema);
  const events = await tenant.dangerEvents.listRecent(query);
  return Response.json({ dangerEvents: events.map(dangerEventView) });
});
