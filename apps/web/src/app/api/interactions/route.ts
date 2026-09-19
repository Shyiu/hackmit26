import { NextResponse } from "next/server";

// Question log and latency stats, read from the `interactions` collection.
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
