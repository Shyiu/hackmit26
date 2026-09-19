import { NextResponse } from "next/server";

// Mints a short-lived token for the perception frame socket. A browser can't set
// headers on a WebSocket, so the headset page sends it as the first message.
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
