import { HttpError, withTenant } from "@/lib/server/api";
import { perceptionFetch } from "@/lib/server/perception";

export const DELETE = withTenant<{ id: string }>("caregiver", async ({ params, principal }) => {
  if (!/^[0-9a-f]{24}$/.test(params.id)) throw new HttpError(404, "No such person");
  await perceptionFetch(principal.patientId, `/people/${params.id}`, { method: "DELETE" });
  return new Response(null, { status: 204 });
});
