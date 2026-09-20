import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { patientHasCaregiver } from "@memory-glasses/db";
import { DEVICE_COOKIE, principalFromDeviceToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ConnectCaregiverPanel } from "./connect-caregiver-panel";

export const metadata: Metadata = { title: "Connect a caregiver" };

// Where a signed-in wearer lands until a caregiver has joined them: the code
// goes to the caregiver, who enters it under Settings on their dashboard.
export default async function WearerConnectPage() {
  const device = (await cookies()).get(DEVICE_COOKIE)?.value;
  const principal = device ? await principalFromDeviceToken(device) : null;
  if (!principal) redirect("/login");
  if (await patientHasCaregiver(getDb(), principal.patientId)) redirect("/wear");

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Connect a caregiver</h1>
        <p className="text-sm text-muted-foreground">
          Read this code to the caregiver who looks after you. They enter it under Settings on their
          dashboard, and this page moves on by itself once they do.
        </p>
      </div>
      <ConnectCaregiverPanel />
    </div>
  );
}
