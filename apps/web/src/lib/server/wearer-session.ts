import "server-only";
import { patientHasCaregiver, tenantRepos, type PatientId } from "@memory-glasses/db";
import type { NextResponse } from "next/server";
import { DEVICE_TOKEN_TTL_SECONDS, mintDeviceToken } from "./auth";
import { getDb } from "./db";
import { setDeviceCookie } from "./session-cookie";

// A wearer who made their own account signs in as a device, not as a caregiver:
// /wear and the API already accept a device token, and it is the wearer's own
// phone either way. The one device is reused, so signing in again on it doesn't
// pile up entries in the caregiver's device list.
const WEARER_DEVICE_LABEL = "Wearer phone";

export async function signInWearer(response: NextResponse, patientId: PatientId): Promise<void> {
  const devices = tenantRepos(getDb(), patientId).devices;
  const existing = (await devices.list()).find(
    (device) => device.revokedAt === null && device.label === WEARER_DEVICE_LABEL,
  );
  const device = existing ?? (await devices.register({ kind: "headset", label: WEARER_DEVICE_LABEL }));
  const minted = await mintDeviceToken({
    patientId,
    deviceId: device._id,
    tokenVersion: device.tokenVersion,
    scope: "api",
    ttlSeconds: DEVICE_TOKEN_TTL_SECONDS,
  });
  setDeviceCookie(response, minted.token);
}

/** Where a signed-in wearer belongs: connecting a caregiver comes before wearing. */
export async function wearerLanding(patientId: PatientId): Promise<string> {
  return (await patientHasCaregiver(getDb(), patientId)) ? "/wear" : "/wearer-connect";
}
