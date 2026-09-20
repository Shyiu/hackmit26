import { withTenant } from "@/lib/server/api";
import { mintDeviceToken } from "@/lib/server/auth";
import { optionalEnv } from "@/lib/server/env";

// The service checks the token once, when the socket says hello, so it can be short.
const TOKEN_TTL_SECONDS = 10 * 60;

/**
 * Mints a short-lived "debug" scope token for the dashboard's Live view socket
 * (/ws/debug). Caregiver-only: unlike /api/perception/token, a device never needs
 * this, so it isn't exposed to one. The perception service derives the debug WS
 * URL from NEXT_PUBLIC_PERCEPTION_WS_URL, swapping the /ws/frames path.
 */
export const GET = withTenant("caregiver", async ({ principal }) => {
  const minted = await mintDeviceToken({
    patientId: principal.patientId,
    deviceId: null,
    tokenVersion: 0,
    scope: "debug",
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
  const framesUrl = optionalEnv("NEXT_PUBLIC_PERCEPTION_WS_URL");
  const url = framesUrl ? framesUrl.replace(/\/ws\/frames\/?$/, "/ws/debug") : null;
  return Response.json({ ...minted, url });
});
