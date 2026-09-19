# 3. A chest-mounted phone instead of the VR headset

Date: 2026-09-19

Status: accepted. Supersedes [0001](0001-phone-headset-instead-of-ray-ban-meta.md).

## Context

ADR 0001 put the phone in a 3D-printed, Cardboard-style headset so the wearer would see the room through the camera, with captions and labels drawn on top. That meant printing a shell, sourcing lenses, and blocking the wearer's own sight. We dropped it.

## Decision

The phone is worn on the chest in a harness, rear camera forward and tilted down. The wearer sees with their own eyes and hears answers through earbuds. The page is `/wear`, which reuses the camera, wake lock, recorder, feed watchdog, and push-to-talk from `/headset` and drops the stereo view. The live view with item labels moves to the caregiver dashboard.

## Consequences

- Nothing blocks the wearer's sight, so they can walk around, and hands and tabletops are in frame.
- The phone screen is only glanceable, so everything the wearer needs is spoken. That is also what the Ray-Ban Meta client needs later.
- The camera follows the torso, not the eyes, and misses items put down off to the side or up high.
- The screen must stay on for the browser to keep the camera, so heat and battery are the limits.
- On iPhone, answers routed to the earpiece are silent from the chest, so the demo uses earbuds.
- `source: "headset"` in the schemas, the perception service, and the generated validators should become `"chest"`.
