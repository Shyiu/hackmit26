import type { DangerEventId } from "@memory-glasses/db";
import { HttpError, readId, withTenant } from "@/lib/server/api";
import { dangerEventView } from "@/lib/server/views";

// The caregiver has seen this hazard. Only an open event can be acknowledged;
// one that's already acknowledged, dismissed, escalated, or closed is a 409.
export const POST = withTenant<{ id: string }>("caregiver", async ({ params, principal, tenant }) => {
  const id = readId<DangerEventId>(params.id);
  const by = principal.kind === "caregiver" ? principal.caregiverId.toHexString() : "caregiver";
  const event = await tenant.dangerEvents.acknowledge(id, { by });
  if (event) return Response.json(dangerEventView(event));
  const existing = await tenant.dangerEvents.get(id);
  if (!existing) throw new HttpError(404, "Not found");
  throw new HttpError(409, `This alert is already ${existing.status}`, { status: existing.status });
});
