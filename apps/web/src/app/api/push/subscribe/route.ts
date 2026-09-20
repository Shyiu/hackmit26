import { pushSubscribeSchema, pushUnsubscribeSchema } from "@memory-glasses/shared";
import { HttpError, readBody, withTenant } from "@/lib/server/api";
import { vapidConfig } from "@/lib/server/push";

// Registers the caregiver's browser for danger and lost alerts over Web Push.
// README "API sketch". The wearer and caregiver come from the session.
export const POST = withTenant("caregiver", async ({ request, principal, tenant }) => {
  if (!vapidConfig()) throw new HttpError(503, "Web Push isn't configured on this server");
  if (principal.kind !== "caregiver") throw new HttpError(403, "Only a caregiver can do this");
  const input = await readBody(request, pushSubscribeSchema);
  const subscription = await tenant.pushSubscriptions.upsertByEndpoint({
    caregiverId: principal.caregiverId,
    endpoint: input.endpoint,
    keys: input.keys,
    userAgent: request.headers.get("user-agent"),
  });
  return Response.json({ id: subscription._id.toHexString(), createdAt: subscription.createdAt }, { status: 201 });
});

export const DELETE = withTenant("caregiver", async ({ request, tenant }) => {
  const input = await readBody(request, pushUnsubscribeSchema);
  const removed = await tenant.pushSubscriptions.deleteByEndpoint(input.endpoint);
  return Response.json({ removed });
});
