import { updateSettingsSchema } from "@memory-glasses/shared";
import { forgetSettings, HttpError, readBody, withTenant } from "@/lib/server/api";

// GET: the wear page reads speaking rate and whether recording is allowed.
// PATCH: the caregiver changes any subset; the merged result is re-validated.
export const GET = withTenant("any", async ({ settings }) => Response.json({ settings }));

export const PATCH = withTenant("caregiver", async ({ request, principal, tenant }) => {
  const patch = await readBody(request, updateSettingsSchema);
  const patient = await tenant.patient.updateSettings(patch);
  if (!patient) throw new HttpError(404, "Not found");
  forgetSettings(principal.patientId);
  return Response.json({ settings: patient.settings });
});
