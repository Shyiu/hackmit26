import { NextResponse } from "next/server";
import { withTenant } from "@/lib/server/api";
import { clearDeviceCookie } from "@/lib/server/session-cookie";

export const POST = withTenant("any", async ({ principal, tenant }) => {
  if (principal.kind === "device") await tenant.devices.revoke(principal.deviceId);
  const response = new NextResponse(null, { status: 204 });
  clearDeviceCookie(response);
  return response;
});
