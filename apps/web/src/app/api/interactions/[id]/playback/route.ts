import { NextRequest, NextResponse } from "next/server";
import { playbackReportSchema } from "@memory-glasses/shared";

// Records client-reported playback/turn timings, labeled as client telemetry, not
// a server-measured stage. See README "Latency budget" and "Data model".
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = playbackReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ error: "not implemented", id }, { status: 501 });
}
