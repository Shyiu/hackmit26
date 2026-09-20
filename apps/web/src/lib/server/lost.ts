import "server-only";

import type { PatientDoc, PatientSettings, TenantRepos } from "@memory-glasses/db";
import { metersOutside } from "@/lib/geofence";
import type { ReportLocation } from "@memory-glasses/shared";

export const LOST_ALERT_DEDUPE_MS = 10 * 60 * 1000;

function distanceText(distance: number): string {
  const rounded = Math.round(distance > 100 ? distance / 10 : distance) * (distance > 100 ? 10 : 1);
  return `Wearer left the approved area (~${rounded} m away)`;
}

async function queueLostAlert(tenant: TenantRepos, text: string, now: Date): Promise<boolean> {
  const recent = await tenant.notifications.lastOfKind("lost_alert", new Date(now.getTime() - LOST_ALERT_DEDUPE_MS));
  if (recent) return false;
  await tenant.notifications.create({ kind: "lost_alert", text, createdBy: null });
  return true;
}

export async function recordLocation(
  tenant: TenantRepos,
  settings: PatientSettings,
  report: ReportLocation,
  now = new Date(),
): Promise<{ inside: boolean | null; distanceMeters: number | null; alerted: boolean }> {
  const distanceMeters = settings.geofence ? metersOutside(settings.geofence, report, report.accuracy ?? null) : null;
  const inside = distanceMeters === null ? null : distanceMeters <= 0;
  await tenant.patient.recordLocation({
    lat: report.lat,
    lng: report.lng,
    accuracyMeters: report.accuracy ?? null,
    capturedAt: report.capturedAt,
    inside,
  });
  const alerted =
    settings.geofence && distanceMeters !== null && inside === false
      ? await queueLostAlert(tenant, distanceText(distanceMeters), now)
      : false;
  return { inside, distanceMeters, alerted };
}

export async function checkLocationStaleness(
  tenant: TenantRepos,
  settings: PatientSettings,
  patient: PatientDoc | null,
  now = new Date(),
): Promise<boolean> {
  if (!settings.geofence) return false;
  try {
    const session = await tenant.patient.latestCaptureSession();
    if (!session || session.state !== "live") return false;
    const windowMs = settings.locationStaleAfterMinutes * 60_000;
    const lastLocation = patient?.lastLocation;
    if (lastLocation && now.getTime() - lastLocation.receivedAt.getTime() <= windowMs) return false;
    if (!lastLocation && now.getTime() - session.startedAt.getTime() <= windowMs) return false;
    return await queueLostAlert(
      tenant,
      `No location from the phone for ${settings.locationStaleAfterMinutes} minutes`,
      now,
    );
  } catch (error) {
    console.error("Could not check location staleness", error);
    return false;
  }
}
