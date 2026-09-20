import { NextResponse } from "next/server";
import { PATIENT_COOKIE, SESSION_COOKIE } from "@/lib/server/auth";

export async function POST() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(PATIENT_COOKIE);
  return response;
}
