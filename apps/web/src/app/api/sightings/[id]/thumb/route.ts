import type { SightingId } from "@memory-glasses/db";
import { HttpError, readId, withTenant } from "@/lib/server/api";
import { keyframeResponse } from "@/lib/server/keyframes";

export const GET = withTenant<{ id: string }>("caregiver", async ({ params, tenant }) => {
  const sighting = await tenant.sightings.get(readId<SightingId>(params.id));
  if (!sighting?.thumbKey) throw new HttpError(404, "Not found");
  return keyframeResponse(sighting.thumbKey);
});
