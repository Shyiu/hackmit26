import { HttpError, withTenant } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { pushToCaregivers } from "@/lib/server/push";

// Development only: pushes a test alert to every device subscribed for the
// caller's wearer, so the feature is demoable without the perception service.
export const POST = withTenant("caregiver", async ({ principal }) => {
  if (process.env.NODE_ENV === "production") throw new HttpError(404, "Not found");
  const report = await pushToCaregivers(getDb(), principal.patientId, {
    title: "Test alert",
    body: "Web Push is working on this device.",
    url: "/dashboard",
    tag: "push-test",
  });
  if (!report.configured) throw new HttpError(503, "Web Push isn't configured on this server");
  return Response.json(report);
});
