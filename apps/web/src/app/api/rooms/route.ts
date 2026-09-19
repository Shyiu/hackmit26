import { createRoomSchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";
import { roomView } from "@/lib/server/views";

// Caregiver-named rooms. Walkthrough enrollment and reference frames come later.
export const GET = withTenant("caregiver", async ({ tenant }) => {
  const rooms = await tenant.rooms.list();
  return Response.json({ rooms: rooms.map(roomView) });
});

export const POST = withTenant("caregiver", async ({ request, tenant }) => {
  const room = await tenant.rooms.create(await readBody(request, createRoomSchema));
  return Response.json(roomView(room), { status: 201 });
});
