import "server-only";
import type { CaregiverDoc } from "@memory-glasses/db";
import type { NextResponse } from "next/server";
import { PATIENT_COOKIE, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./auth";

/** Signs the caregiver in on this browser. */
export async function setSessionCookie(response: NextResponse, caregiver: CaregiverDoc) {
  response.cookies.set(SESSION_COOKIE, await createSessionToken(caregiver), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function setPatientCookie(response: NextResponse, patientId: string) {
  response.cookies.set(PATIENT_COOKIE, patientId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}
