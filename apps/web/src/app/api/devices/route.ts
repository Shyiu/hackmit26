import { withTenant } from "@/lib/server/api";

export const GET = withTenant("caregiver", async ({ tenant }) => {
  const devices = await tenant.devices.list();
  return Response.json({
    devices: devices.map((device) => ({
      _id: device._id.toHexString(),
      kind: device.kind,
      label: device.label,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      revokedAt: device.revokedAt?.toISOString() ?? null,
      createdAt: device.createdAt.toISOString(),
    })),
  });
});
