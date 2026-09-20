import type { ItemId } from "@memory-glasses/db";
import { HttpError, readId, withTenant } from "@/lib/server/api";
import { itemView } from "@/lib/server/views";

// Recomputes the item's history-derived usual spots on demand, e.g. right after
// a caregiver fixes a mislabeled sighting. Perception and the retention sweep
// keep them fresh on their own; this is the manual path.
export const POST = withTenant<{ id: string }>("caregiver", async ({ params, tenant }) => {
  const item = await tenant.items.recomputeUsualSpots(readId<ItemId>(params.id));
  if (!item) throw new HttpError(404, "Not found");
  return Response.json(itemView(item));
});
