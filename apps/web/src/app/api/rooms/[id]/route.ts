import type { RoomId } from "@memory-glasses/db";
import { updateRoomSchema } from "@memory-glasses/shared";
import { HttpError, readBody, readId, withTenant } from "@/lib/server/api";
import { roomView } from "@/lib/server/views";

// Renames a room or marks it private. "private" is for the later on-device
// privacy gate; the server storing it doesn't keep frames from being uploaded.
export const PATCH = withTenant<{ id: string }>("caregiver", async ({ request, params, tenant }) => {
  const room = await tenant.rooms.update(readId<RoomId>(params.id), await readBody(request, updateRoomSchema));
  if (!room) throw new HttpError(404, "Not found");
  return Response.json(roomView(room));
});
