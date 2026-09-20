import type { DeviceId } from "@memory-glasses/db";
import { HttpError, readId, withTenant } from "@/lib/server/api";
import { deviceView } from "@/lib/server/views";

export const POST = withTenant<{ id: string }>("caregiver", async ({ params, tenant }) => {
  const device = await tenant.devices.revoke(readId<DeviceId>(params.id));
  if (!device) throw new HttpError(404, "Not found");
  return Response.json(deviceView(device));
});
