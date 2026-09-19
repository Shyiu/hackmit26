import { withTenant } from "@/lib/server/api";

// A frame socket that hasn't sent anything for this long counts as gone, even
// if the service never got to mark its session ended.
const STALE_AFTER_MS = 15_000;

// The capture badge: whether the chest camera is live, paused, or offline,
// from the newest capture session the perception service opened.
export const GET = withTenant("any", async ({ tenant }) => {
  const session = await tenant.patient.latestCaptureSession();
  if (!session) return Response.json({ capture: null });
  const heardFrom = session.lastFrameAt ?? session.updatedAt;
  const quiet = Date.now() - heardFrom.getTime() > STALE_AFTER_MS;
  return Response.json({
    capture: {
      state: session.state === "ended" || quiet ? "offline" : session.state,
      source: session.source,
      startedAt: session.startedAt.toISOString(),
      lastFrameAt: session.lastFrameAt?.toISOString() ?? null,
      framesReceived: session.framesReceived,
      framesDropped: session.framesDropped,
    },
  });
});
