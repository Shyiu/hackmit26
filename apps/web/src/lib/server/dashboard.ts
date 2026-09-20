import "server-only";
import { DEFAULT_PATIENT_SETTINGS, tenantRepos } from "@memory-glasses/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { principalFromSession, SESSION_COOKIE } from "./auth";
import { getDb } from "./db";

/**
 * For dashboard server components: the signed-in caregiver's wearer, their
 * settings, and repositories scoped to them. Sends anyone signed out to the
 * login page, which brings them back to `path`.
 */
export async function dashboardTenant(path: string) {
  const principal = await principalFromSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!principal) redirect(`/login?next=${encodeURIComponent(path)}`);
  const patient = await tenantRepos(getDb(), principal.patientId).patient.get();
  const settings = patient ? { ...DEFAULT_PATIENT_SETTINGS, ...patient.settings } : DEFAULT_PATIENT_SETTINGS;
  const tenant = tenantRepos(getDb(), principal.patientId, { retentionDays: settings.retentionDays });
  return { principal, patient, settings, tenant };
}
