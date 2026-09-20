import { createCaregiverPairingCode, createPatient } from "@memory-glasses/db";
import { wearerSignupRequestSchema } from "@memory-glasses/shared";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readBody } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

// The wearer's own first step, no caregiver yet: create the patient, hand back
// a pairing code a caregiver enters at POST /api/auth/attach-patient to join it.
// No session cookie -- there's no caregiver account to sign in as yet.
export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, wearerSignupRequestSchema);
    const db = getDb();
    const patient = await createPatient(db, { displayName: input.wearerName });
    const { code, pairingCode } = await createCaregiverPairingCode(db, patient._id);
    return NextResponse.json(
      { patientId: patient._id.toHexString(), code, expiresAt: pairingCode.expiresAt.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
