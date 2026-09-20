import { createCaregiverPairingCode, patientHasCaregiver } from "@memory-glasses/db";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

// The wearer's side of joining a caregiver: whether one has joined yet, and a
// fresh 6-digit code to read out when the one from signup has expired. The
// caregiver spends it at POST /api/auth/attach-patient.

export const GET = withTenant("device", async ({ principal }) => {
  return NextResponse.json({ linked: await patientHasCaregiver(getDb(), principal.patientId) });
});

export const POST = withTenant("device", async ({ principal }) => {
  const { code, pairingCode } = await createCaregiverPairingCode(getDb(), principal.patientId);
  return NextResponse.json({ code, expiresAt: pairingCode.expiresAt.toISOString() }, { status: 201 });
});
