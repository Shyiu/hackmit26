import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HeadsetView } from "./headset-view";

export const metadata: Metadata = {
  title: "Headset",
  appleWebApp: { capable: true, title: "Headset", statusBarStyle: "black-translucent" },
};

// No pinch zoom: it would throw off the eye calibration.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "black",
  colorScheme: "dark",
};

// The wearer's view: the phone's rear camera once per eye, with the HUD on top.
// See README "The headset: a phone in a printed shell".
// The caregiver signs in on the phone once; the page trades that session for
// short-lived device tokens.
export default async function HeadsetPage() {
  if (!(await getSession())) {
    redirect("/login?next=/headset");
  }

  return <HeadsetView />;
}
