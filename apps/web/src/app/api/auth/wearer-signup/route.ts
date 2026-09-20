import {
  createCaregiverPairingCode,
  createPatient,
  duplicateKeyOf,
  findCaregiverByEmail,
  findPatientByAccountEmail,
} from "@memory-glasses/db";
import { wearerSignupRequestSchema } from "@memory-glasses/shared";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, problem, readBody } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/password";
import { signInWearer } from "@/lib/server/wearer-session";

// The wearer's own first step, no caregiver yet: create the patient, hand back
// a pairing code a caregiver enters at POST /api/auth/attach-patient to join it.
// An email and a password also give the wearer an account to sign back into,
// and this device is signed in as them right away.
const TAKEN = "That email already has an account";

export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, wearerSignupRequestSchema);
    const db = getDb();
    const account =
      input.email && input.password
        ? { email: input.email, passwordHash: await hashPassword(input.password) }
        : undefined;
    if (account && ((await findCaregiverByEmail(db, account.email)) || (await findPatientByAccountEmail(db, account.email)))) {
      return problem(409, TAKEN);
    }

    let patient;
    try {
      patient = await createPatient(db, { displayName: input.wearerName, account });
    } catch (error) {
      if (duplicateKeyOf(error)) return problem(409, TAKEN);
      throw error;
    }
    const { code, pairingCode } = await createCaregiverPairingCode(db, patient._id);
    const response = NextResponse.json(
      {
        patientId: patient._id.toHexString(),
        code,
        expiresAt: pairingCode.expiresAt.toISOString(),
        signedIn: account !== undefined,
      },
      { status: 201 },
    );
    if (account) await signInWearer(response, patient._id);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
