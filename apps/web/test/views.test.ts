import { describe, expect, it } from "vitest";
import { ObjectId, type CaptureSessionDoc } from "@memory-glasses/db";
import { captureView } from "@/lib/server/views";

const NOW = new Date("2026-01-01T12:00:00Z");
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

function session(overrides: Partial<CaptureSessionDoc>): CaptureSessionDoc {
  return {
    _id: new ObjectId() as CaptureSessionDoc["_id"],
    patientId: new ObjectId() as CaptureSessionDoc["patientId"],
    deviceId: null,
    source: "simulator",
    state: "paused",
    startedAt: secondsAgo(120),
    updatedAt: secondsAgo(120),
    endedAt: null,
    lastFrameAt: null,
    lastSeq: 0,
    framesReceived: 0,
    framesDropped: 0,
    expiresAt: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  };
}

describe("captureView", () => {
  it("reports a paused session as paused while the socket keeps updatedAt fresh", () => {
    // The wearer paused, so frames stopped an hour ago, but the socket is still
    // open and the heartbeat bumped updatedAt two seconds back.
    const view = captureView(
      session({ lastFrameAt: secondsAgo(60), updatedAt: secondsAgo(2) }),
      NOW,
    );
    expect(view.state).toBe("paused");
  });

  it("reports a paused session offline once everything is stale", () => {
    const view = captureView(
      session({ lastFrameAt: secondsAgo(60), updatedAt: secondsAgo(60) }),
      NOW,
    );
    expect(view.state).toBe("offline");
  });

  it("reports a live session live when frames are arriving", () => {
    const view = captureView(
      session({ state: "live", lastFrameAt: secondsAgo(1), updatedAt: secondsAgo(60) }),
      NOW,
    );
    expect(view.state).toBe("live");
  });

  it("reports an ended session offline even if it just happened", () => {
    const view = captureView(
      session({ state: "ended", endedAt: secondsAgo(1), lastFrameAt: secondsAgo(1), updatedAt: secondsAgo(1) }),
      NOW,
    );
    expect(view.state).toBe("offline");
  });
});
