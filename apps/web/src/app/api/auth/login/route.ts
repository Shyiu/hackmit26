import { findCaregiverByEmail, findPatientByAccountEmail, recordLogin } from "@memory-glasses/db";
import { loginRequestSchema, type LoginResponse } from "@memory-glasses/shared";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, problem, readBody } from "@/lib/server/api";
import { credentialsMatch } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { optionalEnv } from "@/lib/server/env";
import { burnPasswordCheck, verifyPassword } from "@/lib/server/password";
import { setSessionCookie } from "@/lib/server/session-cookie";
import { signInWearer, wearerLanding } from "@/lib/server/wearer-session";

// Signs in either kind of account. A caregiver gets the session cookie and the
// dashboard; a wearer who signed themselves up gets a device token for their own
// phone and the wear page, by way of connecting a caregiver first. Accounts made
// through signup check their stored hash; the seeded demo caregiver has none and
// checks CAREGIVER_EMAIL and CAREGIVER_PASSWORD instead. Every failure gets the
// same message.
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await readBody(request, loginRequestSchema);
    const caregiver = await findCaregiverByEmail(getDb(), email);

    if (!caregiver) {
      const wearer = await findPatientByAccountEmail(getDb(), email);
      if (wearer?.account) {
        if (!(await verifyPassword(password, wearer.account.passwordHash))) {
          return problem(401, "Wrong email or password");
        }
        const body: LoginResponse = { kind: "wearer", next: await wearerLanding(wearer._id) };
        const response = NextResponse.json(body);
        await signInWearer(response, wearer._id);
        return response;
      }
    }

    let ok: boolean;
    if (caregiver?.passwordHash) {
      ok = await verifyPassword(password, caregiver.passwordHash);
    } else {
      const demoConfigured = optionalEnv("CAREGIVER_EMAIL") && optionalEnv("CAREGIVER_PASSWORD");
      ok = demoConfigured ? credentialsMatch(email, password) : false;
      if (!caregiver) await burnPasswordCheck(password);
    }
    if (!ok) return problem(401, "Wrong email or password");
    if (!caregiver) return problem(403, "No caregiver with that email in the database. Run pnpm db:seed.");

    await recordLogin(getDb(), caregiver._id);
    const body: LoginResponse = { kind: "caregiver", next: "/dashboard" };
    const response = NextResponse.json(body);
    await setSessionCookie(response, caregiver);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
