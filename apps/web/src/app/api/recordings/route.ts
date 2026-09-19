import { NextRequest, NextResponse } from "next/server";
import { createRecordingSchema } from "@memory-glasses/shared";

// Optional, after M3. Registers a recording that's about to leave the phone. In
// the MVP recordings stay on the phone and nothing calls this.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createRecordingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
