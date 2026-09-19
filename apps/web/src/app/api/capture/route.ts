import { withTenant } from "@/lib/server/api";
import { captureView } from "@/lib/server/views";

// The capture badge: whether the chest camera is live, paused, or offline,
// from the newest capture session the perception service opened.
export const GET = withTenant("any", async ({ tenant }) => {
  const session = await tenant.patient.latestCaptureSession();
  return Response.json({ capture: session && captureView(session, new Date()) });
});
