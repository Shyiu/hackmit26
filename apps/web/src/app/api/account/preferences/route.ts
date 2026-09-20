import { caregiverPreferences, findCaregiverById, updateCaregiverPreferences } from "@memory-glasses/db";
import { updateCaregiverPreferencesSchema } from "@memory-glasses/shared";
import { HttpError, readBody, withTenant } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

// The signed-in caregiver's own dashboard preferences, independent of which
// wearer is selected. Wearer-facing settings live at /api/settings.
export const GET = withTenant("caregiver", async ({ principal }) => {
  if (principal.kind !== "caregiver") throw new HttpError(403, "Only a caregiver can do this");
  const caregiver = await findCaregiverById(getDb(), principal.caregiverId);
  if (!caregiver) throw new HttpError(404, "Not found");
  return Response.json({ preferences: caregiverPreferences(caregiver) });
});

export const PATCH = withTenant("caregiver", async ({ request, principal }) => {
  if (principal.kind !== "caregiver") throw new HttpError(403, "Only a caregiver can do this");
  const patch = await readBody(request, updateCaregiverPreferencesSchema);
  const caregiver = await updateCaregiverPreferences(getDb(), principal.caregiverId, patch);
  if (!caregiver) throw new HttpError(404, "Not found");
  return Response.json({ preferences: caregiverPreferences(caregiver) });
});
