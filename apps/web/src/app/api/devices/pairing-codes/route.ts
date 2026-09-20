import { HttpError, withTenant } from "@/lib/server/api";

export const POST = withTenant("caregiver", async ({ principal, tenant }) => {
  if (principal.kind !== "caregiver") throw new HttpError(403, "Only a caregiver can do this");
  const { code, pairingCode } = await tenant.pairingCodes.create({ createdBy: principal.caregiverId });
  return Response.json({ code, expiresAt: pairingCode.expiresAt.toISOString() }, { status: 201 });
});
