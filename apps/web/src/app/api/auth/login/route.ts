import { findCaregiverByEmail, recordLogin } from "@memory-glasses/db";
import { loginRequestSchema } from "@memory-glasses/shared";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, problem, readBody } from "@/lib/server/api";
import { createSessionToken, credentialsMatch, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

// Signs in the one caregiver configured in env. The caregiver document, written
// by `pnpm db:seed`, says which wearers they can see.
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await readBody(request, loginRequestSchema);
    if (!credentialsMatch(email, password)) return problem(401, "Wrong email or password");

    const caregiver = await findCaregiverByEmail(getDb(), email);
    if (!caregiver) return problem(403, "No caregiver with that email in the database. Run pnpm db:seed.");
    await recordLogin(getDb(), caregiver._id);

    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(SESSION_COOKIE, await createSessionToken(caregiver), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
