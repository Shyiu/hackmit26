import { NextResponse } from "next/server";

// Mints a short-lived Deepgram key so the client streams audio directly and skips a hop.
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
