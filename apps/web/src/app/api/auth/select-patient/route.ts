import { selectPatientRequestSchema } from "@memory-glasses/shared";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody } from "@/lib/server/api";
import { principalFromSession, SESSION_COOKIE } from "@/lib/server/auth";
import { setPatientCookie } from "@/lib/server/session-cookie";

export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, selectPatientRequestSchema);
    const principal = await principalFromSession(request.cookies.get(SESSION_COOKIE)?.value, input.patientId);
    if (!principal || principal.kind !== "caregiver") {
      throw new HttpError(404, "That wearer isn't on this account");
    }
    const response = NextResponse.json({ patientId: principal.patientId.toHexString() });
    setPatientCookie(response, principal.patientId.toHexString());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
