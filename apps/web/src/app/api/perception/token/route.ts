import { HttpError, withTenant } from "@/lib/server/api";
import { mintDeviceToken } from "@/lib/server/auth";
import { optionalEnv } from "@/lib/server/env";

// The service checks the token once, when the socket says hello, so it can be short.
const TOKEN_TTL_SECONDS = 10 * 60;

// Mints a short-lived token for the perception frame socket. A browser can't set
// headers on a WebSocket, so the headset page sends it as the first message.
export const GET = withTenant("any", async ({ principal, tenant }) => {
  let tokenVersion = 0;
  if (principal.kind === "device" && principal.deviceId) {
    const device = await tenant.devices.getActive(principal.deviceId);
    if (!device) throw new HttpError(403, "This device was revoked");
    tokenVersion = device.tokenVersion;
  }
  const minted = await mintDeviceToken({
    patientId: principal.patientId,
    deviceId: principal.kind === "device" ? principal.deviceId : null,
    tokenVersion,
    scope: "frames",
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
  return Response.json({ ...minted, url: optionalEnv("NEXT_PUBLIC_PERCEPTION_WS_URL") ?? null });
});
