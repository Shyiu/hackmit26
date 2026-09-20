import "server-only";
import {
  patientHasCaregiver,
  setWearerAccountDevice,
  tenantRepos,
  type DeviceId,
  type PatientDoc,
  type PatientId,
} from "@memory-glasses/db";
import type { NextResponse } from "next/server";
import { DEVICE_TOKEN_TTL_SECONDS, mintDeviceToken } from "./auth";
import { getDb } from "./db";
import { clearSessionCookies, setDeviceCookie } from "./session-cookie";

// A wearer who made their own account signs in as a device, not as a caregiver:
// /wear and the API already accept a device token, and it is the wearer's own
// phone either way. The account remembers which device that is, so signing in
// again reuses it rather than piling up entries in the caregiver's device list,
// and so no other device a caregiver paired can act as the account.
const WEARER_DEVICE_LABEL = "Wearer phone";

export async function signInWearer(response: NextResponse, patient: PatientDoc): Promise<void> {
  const devices = tenantRepos(getDb(), patient._id).devices;
  const remembered = patient.account?.deviceId ?? null;
  const existing = remembered ? await devices.getActive(remembered) : null;
  const device = existing ?? (await devices.register({ kind: "headset", label: WEARER_DEVICE_LABEL }));
  if (!device._id.equals(remembered)) await setWearerAccountDevice(getDb(), patient._id, device._id);

  const minted = await mintDeviceToken({
    patientId: patient._id,
    deviceId: device._id,
    tokenVersion: device.tokenVersion,
    scope: "api",
    ttlSeconds: DEVICE_TOKEN_TTL_SECONDS,
  });
  setDeviceCookie(response, minted.token);
  clearSessionCookies(response);
}

/** The wearer's own account device, as opposed to any device a caregiver paired. */
export function isWearerAccountDevice(patient: PatientDoc | null, deviceId: DeviceId): boolean {
  return patient?.account?.deviceId?.equals(deviceId) ?? false;
}

/** Where a signed-in wearer belongs: connecting a caregiver comes before wearing. */
export async function wearerLanding(patientId: PatientId): Promise<string> {
  return (await patientHasCaregiver(getDb(), patientId)) ? "/wear" : "/wearer-connect";
}
