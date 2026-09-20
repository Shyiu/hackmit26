import type { Metadata, Viewport } from "next";
import { WearView } from "./wear-view";

export const metadata: Metadata = {
  title: "Wear",
  appleWebApp: { capable: true, title: "Memoir", statusBarStyle: "default" },
};

// No pinch zoom: a tap anywhere is the ask button.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f4f6fa",
  colorScheme: "light",
};

// The chest page: the rear camera streams frames, a tap asks a question, and
// the answer is spoken and shown as a caption. README "What the page has to do".
export default function WearPage() {
  return <WearView />;
}
