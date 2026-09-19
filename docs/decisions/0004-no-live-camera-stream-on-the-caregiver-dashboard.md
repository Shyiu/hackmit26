# 4. No live camera stream on the caregiver dashboard

Date: 2026-09-19

Status: accepted. Amends [0003](0003-chest-mounted-phone-instead-of-headset.md).

## Context

ADR 0003 moved the live view with item labels to the caregiver dashboard, since a chest-mounted
phone is only glanceable. That put a continuous view of a person's home on a second person's
screen, and it made the demo depend on a stream nothing else in the product needs.

## Decision

The caregiver side carries no camera stream. The dashboard stays read-only over stored data: item
cards, sighting timelines, the question log, latency, and capture/pause state. Item labels and
sighting notifications draw over the wearer's own video, on the capture page that already receives
detections on `/ws/frames`. The perception service has no debug socket, and the `debug` token scope
is gone.

## Consequences

- Nobody but the wearer sees the camera, which is the privacy story we want to be able to state
  plainly.
- Judges watch the demo by mirroring the wearer's phone screen or by running `/sim` on a laptop.
- Labels have to be readable on the phone, glanceable or not, since there is no second screen.
- The detections the capture page already receives are the only detection consumer, so the frame
  socket stays the single perception interface.
