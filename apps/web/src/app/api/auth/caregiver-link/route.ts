import { createCaregiverPairingCode, findPatientById, patientHasCaregiver } from "@memory-glasses/db";
import { NextResponse } from "next/server";
import { problem, withTenant } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { isWearerAccountDevice } from "@/lib/server/wearer-session";

// The wearer's side of joining a caregiver: whether one has joined yet, and a
// fresh 6-digit code to read out when the one from signup has expired. The
// caregiver spends it at POST /api/auth/attach-patient.
//
// A code hands whoever redeems it the whole record, so only the wearer's own
// account device may mint one, and only while nobody looks after them yet: a
// headset a caregiver paired must not be able to invite a second caregiver.

export const GET = withTenant("device", async ({ principal }) => {
  return NextResponse.json({ linked: await patientHasCaregiver(getDb(), principal.patientId) });
});

export const POST = withTenant("device", async ({ principal }) => {
  const patient = await findPatientById(getDb(), principal.patientId);
  if (principal.kind !== "device" || !isWearerAccountDevice(patient, principal.deviceId)) {
    return problem(403, "Only the wearer's own account can invite a caregiver.");
  }
  if (await patientHasCaregiver(getDb(), principal.patientId)) {
    return problem(409, "A caregiver already looks after this account.");
  }
  const { code, pairingCode } = await createCaregiverPairingCode(getDb(), principal.patientId);
  return NextResponse.json({ code, expiresAt: pairingCode.expiresAt.toISOString() }, { status: 201 });
});
