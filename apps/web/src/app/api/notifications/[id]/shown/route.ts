import { NextRequest, NextResponse } from "next/server";

// Marks a notification shown once the HUD has displayed and spoken it. Until then
// it stays queued, so one dropped behind an answer comes back on the next poll.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json({ error: "not implemented", id }, { status: 501 });
}
