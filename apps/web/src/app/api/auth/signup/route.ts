import { collection, createCaregiver, createPatient, duplicateKeyOf, findCaregiverByEmail } from "@memory-glasses/db";
import { signupRequestSchema } from "@memory-glasses/shared";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, problem, readBody } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/password";
import { setSessionCookie } from "@/lib/server/session-cookie";

const TAKEN = "An account with that email already exists. Sign in instead.";

// A new family: one wearer and the caregiver who looks after them, signed in
// at once. Each signup gets its own wearer, so families never share data.
export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, signupRequestSchema);
    const db = getDb();
    if (await findCaregiverByEmail(db, input.email)) return problem(409, TAKEN);

    const passwordHash = await hashPassword(input.password);
    const patient = await createPatient(db, { displayName: input.wearerName });
    let caregiver;
    try {
      caregiver = await createCaregiver(db, {
        email: input.email,
        name: input.name,
        patientIds: [patient._id],
        passwordHash,
      });
    } catch (error) {
      // Lost a race with another signup for the same email. Don't leave an orphan wearer.
      await collection(db, "patients").deleteOne({ _id: patient._id });
      if (duplicateKeyOf(error)) return problem(409, TAKEN);
      throw error;
    }

    const response = NextResponse.json({ ok: true }, { status: 201 });
    await setSessionCookie(response, caregiver);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
