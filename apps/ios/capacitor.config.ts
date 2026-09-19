import type { CapacitorConfig } from "@capacitor/cli";

// The shell has no bundled web app. The WKWebView loads the deployed Next.js app (a Vercel URL or
// a cloudflared tunnel), read from CAP_SERVER_URL when `cap sync` runs and baked into
// ios/App/App/capacitor.config.json. Camera and mic need a secure context, so only https:// is
// accepted. Without a URL the app shows the placeholder page in www/.
const serverUrl = process.env.CAP_SERVER_URL?.trim().replace(/\/+$/, "");

if (!serverUrl) {
  console.warn(
    [
      "",
      "!!! CAP_SERVER_URL is not set. The app will only show the placeholder page.",
      "!!! Run: CAP_SERVER_URL=https://<your-app> pnpm sync",
      "",
    ].join("\n"),
  );
} else {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error(`CAP_SERVER_URL is not a valid URL: ${serverUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `CAP_SERVER_URL must be https:// because getUserMedia needs a secure context. Got ${serverUrl}`,
    );
  }
}

const config: CapacitorConfig = {
  appId: "com.memoryglasses.app",
  appName: "Memory glasses",
  webDir: "www",
  backgroundColor: "#000000",
  server: serverUrl ? { url: serverUrl, cleartext: false } : undefined,
  ios: {
    // The web app sets viewport-fit=cover and pads with env(safe-area-inset-*), so the web view
    // runs edge to edge and the page handles the notch itself.
    contentInset: "never",
    backgroundColor: "#000000",
    scrollEnabled: true,
  },
};

export default config;
