# 1. A phone in a 3D-printed headset instead of Ray-Ban Meta

Date: 2026-09-19

Status: accepted

## Context

The plan assumed Ray-Ban Meta glasses, streaming video to a native iOS app through Meta's Wearables Device Access Toolkit. We can't get a pair for the hackathon.

## Decision

The hackathon build runs on a phone inside a 3D-printed, Cardboard-style headset. The phone's rear camera is the wearer's eyes. A web page, `/headset`, shows the camera feed once per eye and draws a HUD over it with answer captions, item labels, and notifications. The phone records video to a local file.

The client is a web page, not a native app. The browser covers camera, mic, recording, and wake lock on Android and iPhone, and nobody has to learn Swift or join a developer program before the first test.

Ray-Ban Meta stays in the plan as a second client on the same two endpoints, the frame socket and `POST /api/ask`.

## Consequences

- Perception gets 1080p frames instead of the glasses' 720p, which helps with small items like keys.
- The wearer gets a display, so answers can be captioned and items labeled. Everything important still goes through the voice, so an audio-only glasses client loses nothing.
- The phone needs HTTPS and WSS from the first test, so dev servers sit behind tunnels.
- iPhone Safari has no element fullscreen, sends answer audio to the earpiece while the mic is open, and can switch rear lenses on its own. Android Chrome avoids all three.
- The wearer sees through one camera with no depth and some lag. The demo is seated or standing with a spotter, and the rig never goes on a person with dementia.
- Labels stay in screen space. Labels pinned to the room need ARKit or ARCore in a native app, which is a stretch goal.
- The print, the lenses, heat, and battery are new ways to fail. The flat `/sim` page stays the fallback.
