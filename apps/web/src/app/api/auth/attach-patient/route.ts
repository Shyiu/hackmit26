import { addPatientToCaregiver, redeemCaregiverPairingCode } from "@memory-glasses/db";
import { attachPatientRequestSchema } from "@memory-glasses/shared";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody } from "@/lib/server/api";
import { principalFromSession, SESSION_COOKIE } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { setSessionCookie } from "@/lib/server/session-cookie";

// An already-signed-in caregiver joining a second wearer's patient by code.
// Not withTenant: that middleware scopes to a patientId the caregiver's session
// already carries, but the whole point here is attaching one they don't have yet.
export async function POST(request: NextRequest) {
  try {
    const principal = await principalFromSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!principal || principal.kind !== "caregiver") throw new HttpError(401, "Sign in first");
    const input = await readBody(request, attachPatientRequestSchema);
    const db = getDb();
    const redeemed = await redeemCaregiverPairingCode(db, input.code);
    if (redeemed.kind === "invalid") {
      throw new HttpError(401, "That code didn't work. Ask the wearer's setup device for a new one.");
    }
    const patientId = redeemed.pairingCode.patientId;
    const attached = await addPatientToCaregiver(db, principal.caregiverId, patientId);
    if (attached.kind === "not_found") throw new HttpError(404, "That account no longer exists");
    if (attached.kind === "full") throw new HttpError(422, "You've already reached the limit of wearers on one account");

    const response = NextResponse.json({ patientId: patientId.toHexString() }, { status: 200 });
    // sessionClaimsSchema.pids is signed into the cookie at login, so refresh it here --
    // otherwise the caregiver wouldn't see the newly attached patient until logging in again.
    await setSessionCookie(response, attached.caregiver);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
