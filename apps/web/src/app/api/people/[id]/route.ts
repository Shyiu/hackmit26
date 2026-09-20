import { readId, withTenant } from "@/lib/server/api";
import { perceptionError, perceptionFetch } from "@/lib/server/perception";
import { HttpError } from "@/lib/server/api";
import type { PersonId } from "@memory-glasses/db";

export const DELETE = withTenant<{ id: string }>("caregiver", async ({ params, principal, tenant }) => {
  const id = readId<PersonId>(params.id);
  // Check ownership here as well: the service scopes by the token, this gives a clean 404.
  const people = await tenant.people.list();
  if (!people.some((person) => person._id.equals(id))) throw new HttpError(404, "Not found");
  const response = await perceptionFetch(principal.patientId, `/people/${id.toHexString()}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw await perceptionError(response);
  return new Response(null, { status: 204 });
});
