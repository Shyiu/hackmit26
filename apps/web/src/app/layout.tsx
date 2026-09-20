import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

// Inter is the app-chrome face: it holds up at the 12–13px the dashboard runs at.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const monoCode = Geist_Mono({
  variable: "--font-mono-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Memoir", template: "%s · Memoir" },
  description: "A wearable camera that remembers where things are, for people living with dementia.",
  applicationName: "Memoir",
  // "Add to Home Screen" on iPhone opens the app without Safari's chrome.
  appleWebApp: { capable: true, title: "Memoir", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

// viewport-fit=cover lets pages paint under the notch and home indicator; the
// safe-area utilities in globals.css keep content out from under them.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${monoCode.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
