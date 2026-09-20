import type { DeviceId } from "@memory-glasses/db";
import { HttpError, readId, withTenant } from "@/lib/server/api";

export const POST = withTenant<{ id: string }>("caregiver", async ({ params, tenant }) => {
  const device = await tenant.devices.revoke(readId<DeviceId>(params.id));
  if (!device) throw new HttpError(404, "Not found");
  return Response.json({
    _id: device._id.toHexString(),
    kind: device.kind,
    label: device.label,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
  });
});
