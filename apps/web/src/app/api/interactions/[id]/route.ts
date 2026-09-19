import { NextRequest, NextResponse } from "next/server";

// Poll authorized answer text, status, and final server timings for one interaction.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json({ error: "not implemented", id }, { status: 501 });
}
