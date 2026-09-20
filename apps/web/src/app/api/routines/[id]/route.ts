import type { RoutineId } from "@memory-glasses/db";
import { updateRoutineSchema } from "@memory-glasses/shared";
import { HttpError, readBody, readId, withTenant } from "@/lib/server/api";
import { routineView } from "@/lib/server/views";

export const PATCH = withTenant<{ id: string }>("caregiver", async ({ request, params, tenant }) => {
  const routine = await tenant.routines.update(readId<RoutineId>(params.id), await readBody(request, updateRoutineSchema));
  if (!routine) throw new HttpError(404, "Not found");
  return Response.json(routineView(routine));
});
