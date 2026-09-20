import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
