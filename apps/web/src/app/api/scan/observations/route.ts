import { parseId, type ItemId } from "@memory-glasses/db";
import { postScanObservationsBodySchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";

// Where tracked items sat in one frame sent to the live scan. The pin gets its 3D position
// later, once splat-slam has posed that frame. Items this wearer doesn't have are skipped.
export const POST = withTenant("any", async ({ request, tenant }) => {
  const input = await readBody(request, postScanObservationsBodySchema);
  const seenAt = input.seenAt ? new Date(input.seenAt) : new Date();
  const known = new Set((await tenant.items.list()).map((item) => item._id.toHexString()));
  let recorded = 0;
  for (const { itemId: raw, u, v } of input.observations) {
    const itemId = parseId<ItemId>(raw);
    if (!itemId || !known.has(itemId.toHexString())) continue;
    await tenant.scanPins.recordObservation({ itemId, sceneId: input.sceneId, frame: input.frame, u, v, seenAt });
    recorded += 1;
  }
  return Response.json({ ok: true, recorded });
});
