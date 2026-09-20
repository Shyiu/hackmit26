import { describe, expect, it } from "vitest";
import {
  postScanObservationsBodySchema,
  putScanPinBodySchema,
  scanLiveStateSchema,
  scanPinSchema,
  STATIC_SCAN_SCENE_ID,
} from "../src/schemas/scan";

const ITEM = "5eed00000000000000000001";
const AT = "2026-09-20T12:00:00.000Z";

describe("scanPinSchema", () => {
  it("accepts a placed pin and one still waiting for a pose", () => {
    const base = { itemId: ITEM, itemName: "keys", sceneId: STATIC_SCAN_SCENE_ID, seenAt: AT, updatedAt: AT };
    expect(scanPinSchema.safeParse({ ...base, position: [0.1, 1, -2], observation: null, source: "seed" }).success).toBe(true);
    expect(
      scanPinSchema.safeParse({
        ...base,
        position: null,
        observation: { frame: "s0/000012.jpg", u: 0.5, v: 1 },
        source: "slam",
      }).success,
    ).toBe(true);
  });

  it("rejects a short vector, a non-finite number, and an off-frame observation", () => {
    const base = { itemId: ITEM, itemName: "keys", sceneId: "abc", source: "slam", seenAt: AT, updatedAt: AT };
    expect(scanPinSchema.safeParse({ ...base, position: [0, 1], observation: null }).success).toBe(false);
    expect(scanPinSchema.safeParse({ ...base, position: [0, 1, Infinity], observation: null }).success).toBe(false);
    expect(
      scanPinSchema.safeParse({ ...base, position: null, observation: { frame: "f.jpg", u: 1.2, v: 0 } }).success,
    ).toBe(false);
  });
});

describe("putScanPinBodySchema", () => {
  const body = { itemId: ITEM, sceneId: "abc", position: [1, 2, 3], source: "manual" };

  it("accepts a manual pin and a slam pin tied to a frame", () => {
    expect(putScanPinBodySchema.safeParse(body).success).toBe(true);
    expect(putScanPinBodySchema.safeParse({ ...body, source: "slam", frame: "s0/000012.jpg" }).success).toBe(true);
  });

  it("rejects the seed source, a null position, a bad item id, and extra keys", () => {
    expect(putScanPinBodySchema.safeParse({ ...body, source: "seed" }).success).toBe(false);
    expect(putScanPinBodySchema.safeParse({ ...body, position: null }).success).toBe(false);
    expect(putScanPinBodySchema.safeParse({ ...body, itemId: "keys" }).success).toBe(false);
    expect(putScanPinBodySchema.safeParse({ ...body, patientId: ITEM }).success).toBe(false);
  });
});

describe("postScanObservationsBodySchema", () => {
  const body = { sceneId: "abc", frame: "s0/000012.jpg", observations: [{ itemId: ITEM, u: 0.25, v: 0.75 }] };

  it("accepts one to twenty observations, with or without seenAt", () => {
    expect(postScanObservationsBodySchema.safeParse(body).success).toBe(true);
    expect(postScanObservationsBodySchema.safeParse({ ...body, seenAt: AT }).success).toBe(true);
    const twenty = Array.from({ length: 20 }, () => body.observations[0]);
    expect(postScanObservationsBodySchema.safeParse({ ...body, observations: twenty }).success).toBe(true);
  });

  it("rejects none, too many, an empty frame, and a date that isn't ISO", () => {
    expect(postScanObservationsBodySchema.safeParse({ ...body, observations: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 21 }, () => body.observations[0]);
    expect(postScanObservationsBodySchema.safeParse({ ...body, observations: tooMany }).success).toBe(false);
    expect(postScanObservationsBodySchema.safeParse({ ...body, frame: "" }).success).toBe(false);
    expect(postScanObservationsBodySchema.safeParse({ ...body, seenAt: "yesterday" }).success).toBe(false);
  });
});

describe("scanLiveStateSchema", () => {
  it("keeps splat-slam's scene fields as sent", () => {
    const parsed = scanLiveStateSchema.parse({
      configured: true,
      reachable: true,
      sceneId: "abc",
      scene: { id: "abc", name: `mg-${ITEM}`, splat: "splat/v0003.spz", psnr: 24.1 },
    });
    expect(parsed.scene).toMatchObject({ splat: "splat/v0003.spz", psnr: 24.1 });
    expect(
      scanLiveStateSchema.safeParse({ configured: false, reachable: false, sceneId: null, scene: null }).success,
    ).toBe(true);
  });
});
