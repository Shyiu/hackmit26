import { createDevicePairingCode } from "@memory-glasses/db";
import { devicePairingCodeRequestSchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { createPairingKind } from "@/lib/server/devices";

export const POST = withTenant("caregiver", async ({ request, principal }) => {
  const input = await readBody(request, devicePairingCodeRequestSchema);
  const { code, pairingCode } = await createDevicePairingCode(getDb(), principal.patientId, createPairingKind(input.kind));
  return Response.json({ code, expiresAt: pairingCode.expiresAt.toISOString() }, { status: 201 });
});
