import { withTenant } from "@/lib/server/api";
import { deviceView } from "@/lib/server/views";

export const GET = withTenant("caregiver", async ({ tenant }) => {
  const devices = await tenant.devices.list();
  return Response.json({ devices: devices.map(deviceView) });
});
