# 4. An iOS shell with Capacitor that loads the deployed web app

Date: 2026-09-19

Status: accepted.

## Context

The chest phone runs `/wear` in Safari (ADR 0003). We want the same app installable as an iPhone app, and `apps/ios` is reserved for a native shell that later handles hardware-button push-to-talk, a local wake word, and the Ray-Ban Meta DAT client. The web app is Next.js with API routes and server components, so it can't be exported as static files and bundled into an app.

## Decision

`apps/ios` is a Capacitor 8 project using Swift Package Manager. Its WKWebView loads the deployed web app from `server.url`, set from `CAP_SERVER_URL` at sync time, and the config refuses anything but `https://`. The native side adds three things: camera and mic granted only to that server origin, the idle timer turned off, and the Info.plist usage strings. Web features stay in `apps/web`, so the browser and the app run the same code.

## Consequences

- A web deploy updates the app without an App Store build. The app needs the network and a live server URL; a new tunnel means a new sync.
- The Xcode project is ours to extend in Swift, so the native work planned for `apps/ios` lands in the same project.
- The camera still stops when the screen locks. The shell only keeps the screen from locking on its own. Capture with the screen locked needs native capture code.
- WKWebView has no Web Speech API, so speech to text stays on Deepgram.
- Apple rejects App Store apps that are only a website in a wrapper. This is fine for the hackathon and TestFlight, and the native features are what would make it more than a wrapper.
