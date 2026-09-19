import type { ItemId } from "@memory-glasses/db";
import { updateItemSchema } from "@memory-glasses/shared";
import { HttpError, readBody, readId, withTenant } from "@/lib/server/api";
import { itemView } from "@/lib/server/views";

// Renames, aliases, detector prompts, and archiving (`active: false`).
export const PATCH = withTenant<{ id: string }>("caregiver", async ({ request, params, tenant }) => {
  const id = readId<ItemId>(params.id);
  const { active, ...names } = await readBody(request, updateItemSchema);

  let item = Object.keys(names).length > 0 ? await tenant.items.update(id, names) : await tenant.items.get(id);
  if (item && active !== undefined && active !== item.active) item = await tenant.items.setActive(id, active);
  if (!item) throw new HttpError(404, "Not found");
  return Response.json(itemView(item));
});
