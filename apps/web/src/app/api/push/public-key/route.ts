import { problem, withTenant } from "@/lib/server/api";
import { vapidConfig } from "@/lib/server/push";

// The VAPID public key a browser passes as applicationServerKey. 503 until
// VAPID_* are set, which the Settings toggle reports as "not configured".
export const GET = withTenant("caregiver", async () => {
  const vapid = vapidConfig();
  if (!vapid) return problem(503, "Web Push isn't configured: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT");
  return Response.json({ publicKey: vapid.publicKey });
});
