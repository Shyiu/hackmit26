import type { ItemId } from "@memory-glasses/db";
import { z } from "zod";
import { readId, readQuery, withTenant } from "@/lib/server/api";
import { sightingView } from "@/lib/server/views";

const querySchema = z.object({
  itemId: z.string().optional(),
  since: z.coerce.date().optional(),
  /** Paging: pass the last `lastSeenAt` you got. */
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// Sightings newest first, filtered by item and time range.
export const GET = withTenant("caregiver", async ({ request, tenant }) => {
  const query = readQuery(request, querySchema);
  const sightings = await tenant.sightings.list({
    itemId: query.itemId === undefined ? undefined : readId<ItemId>(query.itemId),
    since: query.since,
    before: query.before,
    limit: query.limit,
  });
  return Response.json({ sightings: sightings.map(sightingView) });
});
