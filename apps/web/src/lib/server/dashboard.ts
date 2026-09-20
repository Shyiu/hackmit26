import "server-only";
import {
  caregiverPreferences,
  DEFAULT_PATIENT_SETTINGS,
  findCaregiverById,
  listPatientsByIds,
  tenantRepos,
  type CaregiverPreferences,
} from "@memory-glasses/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PATIENT_COOKIE, principalFromSession, sessionPatientIds, SESSION_COOKIE, type Principal } from "./auth";
import { getDb } from "./db";

export async function caregiverWearers() {
  const cookieJar = await cookies();
  const session = await sessionPatientIds(cookieJar.get(SESSION_COOKIE)?.value);
  if (!session) return { caregiverId: null, patients: [], selectedId: null };
  const selected = await principalFromSession(
    cookieJar.get(SESSION_COOKIE)?.value,
    undefined,
    cookieJar.get(PATIENT_COOKIE)?.value,
  );
  const patients = await listPatientsByIds(getDb(), session.patientIds);
  return {
    caregiverId: session.caregiverId.toHexString(),
    patients: patients.map((patient) => ({ id: patient._id.toHexString(), displayName: patient.displayName })),
    selectedId: selected?.patientId.toHexString() ?? null,
  };
}

/** The signed-in caregiver's own preferences; a device principal gets the defaults. */
export async function dashboardPreferences(principal: Principal): Promise<CaregiverPreferences> {
  const caregiver = principal.kind === "caregiver" ? await findCaregiverById(getDb(), principal.caregiverId) : null;
  return caregiverPreferences(caregiver);
}

/**
 * For dashboard server components: the signed-in caregiver's wearer, their
 * settings, and repositories scoped to them. Sends anyone signed out to the
 * login page, which brings them back to `path`.
 */
export async function dashboardTenant(path: string) {
  const cookieJar = await cookies();
  const principal = await principalFromSession(
    cookieJar.get(SESSION_COOKIE)?.value,
    undefined,
    cookieJar.get(PATIENT_COOKIE)?.value,
  );
  if (!principal) redirect(`/login?next=${encodeURIComponent(path)}`);
  const patient = await tenantRepos(getDb(), principal.patientId).patient.get();
  const settings = patient?.settings ?? DEFAULT_PATIENT_SETTINGS;
  const tenant = tenantRepos(getDb(), principal.patientId, { retentionDays: settings.retentionDays });
  return { principal, patient, settings, tenant };
}
