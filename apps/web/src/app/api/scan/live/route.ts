import { z } from "zod";
import type { ScanLiveState } from "@memory-glasses/shared";
import { HttpError, readBody, withTenant } from "@/lib/server/api";
import { createScene, liveState, scanConfigured } from "@/lib/server/scan";

const actionSchema = z.object({ action: z.literal("reset") });

// The wearer's live scene on the splat-slam server and how far it has got.
export const GET = withTenant("any", async ({ tenant }) => {
  return Response.json(await liveState(tenant.patientId));
});

// Starts a fresh scene. Pins of the old one stay under its id. Unlike GET, a server that
// is off or down is an error here: 503 when unset, 502 when unreachable.
export const POST = withTenant("any", async ({ request, tenant }) => {
  await readBody(request, actionSchema);
  if (!scanConfigured()) throw new HttpError(503, "Live room scans are off: SPLAT_SLAM_URL is not set.");
  const scene = await createScene(tenant.patientId);
  return Response.json({ configured: true, reachable: true, sceneId: scene.id, scene } satisfies ScanLiveState);
});
