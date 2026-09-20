import type { ItemId } from "@memory-glasses/db";
import { putScanPinBodySchema } from "@memory-glasses/shared";
import { z } from "zod";
import { HttpError, readBody, readId, readQuery, withTenant } from "@/lib/server/api";
import { pinViews } from "@/lib/server/scan";

const querySchema = z
  .object({ sceneId: z.string().min(1).max(100).optional(), itemId: z.string().optional() })
  .refine((query) => query.sceneId || query.itemId, "Pass sceneId or itemId");

// Where each item was last seen in a scan: every pin of one scene, or one item's pins.
export const GET = withTenant("any", async ({ request, tenant }) => {
  const { sceneId, itemId } = readQuery(request, querySchema);
  const docs = itemId
    ? (await tenant.scanPins.listByItem(readId<ItemId>(itemId))).filter((doc) => !sceneId || doc.sceneId === sceneId)
    : await tenant.scanPins.listByScene(sceneId!);
  return Response.json({ pins: await pinViews(tenant, docs) });
});

// Places a pin. The viewer sends `frame` with a position it worked out from that frame's
// camera pose; a 409 means a newer observation arrived while it was working.
export const PUT = withTenant("any", async ({ request, principal, tenant }) => {
  const input = await readBody(request, putScanPinBodySchema);
  if (input.source === "manual" && principal.kind !== "caregiver") {
    throw new HttpError(403, "Only a caregiver can place a pin by hand");
  }
  const itemId = readId<ItemId>(input.itemId);
  const item = await tenant.items.get(itemId);
  if (!item?.active) throw new HttpError(404, "Not found");
  const doc = await tenant.scanPins.setPosition({ ...input, itemId });
  if (!doc) throw new HttpError(409, "A newer observation replaced that frame");
  const [pin] = await pinViews(tenant, [doc]);
  return Response.json({ pin });
});
