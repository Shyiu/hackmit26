import { createItemSchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";
import { itemView } from "@/lib/server/views";

// Item cards: each item with its latest snapshot and what that evidence supports saying.
export const GET = withTenant("any", async ({ tenant }) => {
  const items = await tenant.items.list();
  return Response.json({ items: items.map(itemView) });
});

// Adds a tracked item. A name another item already answers to is a 409.
// TODO(M1): tell the perception service to reload its prompt list.
export const POST = withTenant("caregiver", async ({ request, tenant }) => {
  const input = await readBody(request, createItemSchema);
  const item = await tenant.items.create(input);
  return Response.json(itemView(item), { status: 201 });
});
