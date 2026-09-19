# apps/ios

A Capacitor 8 iOS app that wraps the web app. There is no bundled front end: the WKWebView loads
the deployed Next.js app over HTTPS, either a Vercel URL or a cloudflared tunnel to `pnpm dev`. The
Next.js app has API routes and server components, so it can't be exported as static files.

The project in `ios/` is a normal Xcode project, so the native pieces the root README plans for
`apps/ios` (hardware-button push-to-talk, a local wake word, the Meta DAT client) can be added in
Swift later. See [ADR 0004](../../docs/decisions/0004-ios-shell-with-capacitor.md).

What the native side adds on top of stock Capacitor:

- `BridgeViewController.swift` grants camera and mic to the configured server origin only. Stock
  Capacitor grants every origin.
- `AppDelegate.swift` turns off the idle timer, so the screen stays on while the app is open.
- `Info.plist` has the camera and mic usage strings, all four orientations, and light status bar
  text for the black wear page.

## Prerequisites

- Xcode 16 or newer with an iOS Simulator runtime. Built with Xcode 26.6 and the iOS 26.5 runtime.
- Node 22+ and pnpm. CocoaPods is not needed: the project uses Swift Package Manager, and Xcode
  fetches `capacitor-swift-pm` on the first build.
- The web app running somewhere with HTTPS. Camera and mic need a secure context.

## Point it at the web app

The server URL is read from `CAP_SERVER_URL` when you sync, and written to
`ios/App/App/capacitor.config.json` (git-ignored). Sync again whenever the URL changes, for example
a new tunnel.

```bash
# Tunnel to local dev (from the repo root, in another terminal)
pnpm dev
cloudflared tunnel --url http://localhost:3000

# Then, from apps/ios
CAP_SERVER_URL=https://<name>.trycloudflare.com pnpm sync
# or a Vercel deployment
CAP_SERVER_URL=https://<project>.vercel.app pnpm sync
```

Without `CAP_SERVER_URL` the sync prints a warning and the app shows a placeholder page. An
`http://` URL fails the sync. A fresh clone needs one `pnpm sync` before Xcode can build, because
the synced config and `public/` folder are generated.

`next dev` rejects hostnames it doesn't know, so a new tunnel hostname may need adding to
`allowedDevOrigins` in `apps/web/next.config.ts`.

## Run

```bash
pnpm open        # opens the project in Xcode; pick a simulator or a device and press Run
pnpm build:sim   # command-line simulator build, no signing
```

`build:sim` runs:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

The Simulator has no camera, so it only checks that the app loads the page. Test capture on a phone.

## Signing

The simulator needs no signing. For a device, open the project in Xcode, select the App target,
and under Signing & Capabilities pick your team. A free Apple ID works for your own phone, but the
build expires after 7 days. If `com.memoryglasses.app` is taken for your team, change the bundle ID
there. On the phone, trust the developer profile under Settings > General > VPN & Device
Management the first time.

## Known limits

- The camera still stops when the screen locks. The app keeps the screen on while it's in the
  foreground, but pressing the side button locks it. Capture with the screen locked needs native
  capture code, which isn't written.
- Answer audio drops to the earpiece while the mic is open, same as in Safari. On the chest the
  earpiece is inaudible, so use earbuds. See "What the page has to do" in the root README.
- WKWebView has no Web Speech API, so speech to text has to go through Deepgram (`/api/stt/token`),
  never `SpeechRecognition`.
- The app is a thin client. With no network, or a dead tunnel, it shows a load error.
- iOS asks for camera and mic permission once, the first time the page calls `getUserMedia`.
