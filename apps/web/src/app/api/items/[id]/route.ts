import type { ItemId } from "@memory-glasses/db";
import { updateItemSchema } from "@memory-glasses/shared";
import { HttpError, readBody, readId, withTenant } from "@/lib/server/api";
import { itemView } from "@/lib/server/views";

// Renames, aliases, detector prompts, and archiving (`active: false`). Send the
// `updatedAt` the form loaded as `expectedUpdatedAt` to get a 409 instead of
// overwriting someone else's save.
export const PATCH = withTenant<{ id: string }>("caregiver", async ({ request, params, tenant }) => {
  const item = await tenant.items.update(readId<ItemId>(params.id), await readBody(request, updateItemSchema));
  if (!item) throw new HttpError(404, "Not found");
  return Response.json(itemView(item));
});
