import "server-only";
import type { CaregiverDoc } from "@memory-glasses/db";
import { NextResponse } from "next/server";
import { createSessionToken, DEVICE_TOKEN_TTL_SECONDS, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./auth";
import { DEVICE_COOKIE, PATIENT_COOKIE } from "../session-cookie";

/** Signs the caregiver in on this browser, and off any wearer account it held. */
export async function setSessionCookie(response: NextResponse, caregiver: CaregiverDoc) {
  clearDeviceCookie(response);
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

export function setDeviceCookie(response: NextResponse, token: string) {
  response.cookies.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_TOKEN_TTL_SECONDS,
  });
}

export function clearDeviceCookie(response: NextResponse) {
  expire(response, DEVICE_COOKIE);
}

/** One browser holds one account: signing a wearer in drops any caregiver session. */
export function clearSessionCookies(response: NextResponse) {
  expire(response, SESSION_COOKIE);
  expire(response, PATIENT_COOKIE);
}

function expire(response: NextResponse, name: string) {
  response.cookies.set(name, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
