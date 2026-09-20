import { createRoutineSchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";
import { routineView } from "@/lib/server/views";

export const GET = withTenant("caregiver", async ({ tenant }) => {
  const routines = await tenant.routines.list();
  return Response.json({ routines: routines.map(routineView) });
});

export const POST = withTenant("caregiver", async ({ request, tenant }) => {
  const routine = await tenant.routines.create(await readBody(request, createRoutineSchema));
  return Response.json(routineView(routine), { status: 201 });
});
