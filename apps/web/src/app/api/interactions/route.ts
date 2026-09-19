import { z } from "zod";
import { readQuery, withTenant } from "@/lib/server/api";
import { interactionView } from "@/lib/server/views";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Paging: pass the last `askedAt` you got. */
  before: z.coerce.date().optional(),
  /** Window for the latency percentiles. */
  days: z.coerce.number().int().min(1).max(90).default(7),
});

// Question log and per-stage latency percentiles for the dashboard.
export const GET = withTenant("caregiver", async ({ request, tenant }) => {
  const query = readQuery(request, querySchema);
  const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
  const [interactions, latency] = await Promise.all([
    tenant.interactions.listRecent({ limit: query.limit, before: query.before }),
    tenant.interactions.latencyStats({ since }),
  ]);
  return Response.json({
    interactions: interactions.map(interactionView),
    latency: { since: since.toISOString(), ...latency },
  });
});
