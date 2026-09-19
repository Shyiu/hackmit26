import { NextRequest, NextResponse } from "next/server";
import { createNotificationSchema } from "@memory-glasses/shared";

// Optional, after M3. GET: the headset polls for queued caregiver messages and due
// reminders. POST: the caregiver queues one. See README "What the HUD shows".
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
