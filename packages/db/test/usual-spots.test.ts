import { describe, expect, it } from "vitest";
import { computeUsualSpots, placeKey, type UsualSpotSample } from "../src/usual-spots";

const T0 = new Date("2026-01-01T00:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;
const MINUTE = 60_000;

let seq = 0;
function sighting(
  atMs: number,
  overrides: Partial<UsualSpotSample> = {},
): UsualSpotSample {
  seq += 1;
  return {
    sentence: `spot ${seq}`,
    surface: null,
    relation: null,
    room: null,
    firstSeenAt: new Date(atMs),
    lastSeenAt: new Date(atMs + 30_000),
    descriptionStatus: "ready",
    state: "resting",
    ...overrides,
  };
}

const kitchen = {
  sentence: "on the kitchen counter, next to the coffee maker",
  room: { id: null, name: "kitchen", confidence: 0.9 },
  surface: "counter",
  relation: "next to the coffee maker",
};

describe("placeKey", () => {
  it("keys on room, surface and relation, normalized", () => {
    const a = placeKey(sighting(0, kitchen));
    const b = placeKey(
      sighting(0, {
        ...kitchen,
        room: { id: null, name: "  KITCHEN ", confidence: null },
        surface: "Counter",
      }),
    );
    expect(a).toBe("kitchen|counter|next to the coffee maker");
    expect(b).toBe(a);
  });

  it("falls back to the sentence and is null when nothing names a place", () => {
    expect(placeKey(sighting(0, { sentence: "  On the  Desk " }))).toBe("on the desk");
    expect(placeKey(sighting(0, { sentence: null }))).toBeNull();
  });
});

describe("computeUsualSpots", () => {
  it("returns [] for empty or sparse history", () => {
    expect(computeUsualSpots([])).toEqual([]);
    expect(computeUsualSpots([sighting(0, kitchen), sighting(HOUR, kitchen)])).toEqual([]);
  });

  it("ignores pending, failed, and non-resting sightings", () => {
    const base = { ...kitchen };
    const sightings = [
      sighting(0, base),
      sighting(HOUR, base),
      sighting(2 * HOUR, base),
      sighting(3 * HOUR, { ...base, descriptionStatus: "pending", sentence: null, room: null, surface: null, relation: null }),
      sighting(4 * HOUR, { ...base, descriptionStatus: "failed", sentence: null }),
      sighting(5 * HOUR, { ...base, state: "held" }),
      sighting(6 * HOUR, { ...base, state: "moving" }),
    ];
    const spots = computeUsualSpots(sightings);
    expect(spots).toEqual([
      { sentence: kitchen.sentence, share: 1, samples: 3, source: "history" },
    ]);
  });

  it("merges a fragmented track into one placement", () => {
    // Six sightings at the same place a minute apart are one placement, not six.
    const fragments = Array.from({ length: 6 }, (_, i) =>
      sighting(i * MINUTE, { ...kitchen, sentence: `kitchen fragment ${i + 1}` }),
    );
    const others = [
      sighting(2 * HOUR, { sentence: "on the hallway table", room: { id: null, name: "hallway", confidence: 0.9 }, surface: "table" }),
      sighting(3 * HOUR, { sentence: "on the desk", room: { id: null, name: "office", confidence: 0.9 }, surface: "desk" }),
    ];
    const spots = computeUsualSpots([...fragments, ...others], { minShare: 0 });
    expect(spots).toHaveLength(3);
    const merged = spots.find((spot) => spot.sentence === "kitchen fragment 6");
    expect(merged).toMatchObject({ share: 1 / 3, samples: 1, source: "history" });
  });

  it("orders by share descending and keeps the most recent placement's sentence", () => {
    const sightings = [
      sighting(0, kitchen),
      sighting(HOUR, { sentence: "on the hallway table", room: { id: null, name: "hallway", confidence: 0.9 }, surface: "table" }),
      sighting(2 * HOUR, kitchen),
      sighting(3 * HOUR, { ...kitchen, sentence: "On the Kitchen Counter, Next To The Coffee Maker" }),
    ];
    const spots = computeUsualSpots(sightings);
    expect(spots[0]).toEqual({
      sentence: "On the Kitchen Counter, Next To The Coffee Maker",
      share: 0.75,
      samples: 3,
      source: "history",
    });
    expect(spots[1]).toMatchObject({ sentence: "on the hallway table", share: 0.25, samples: 1 });
  });

  it("drops places below minShare", () => {
    const sightings = [
      ...Array.from({ length: 3 }, (_, i) => sighting(i * HOUR, kitchen)),
      ...Array.from({ length: 3 }, (_, i) =>
        sighting((3 + i) * HOUR, { sentence: "on the hallway table", room: { id: null, name: "hallway", confidence: 0.9 }, surface: "table" }),
      ),
      sighting(6 * HOUR, { sentence: "on the desk", room: { id: null, name: "office", confidence: 0.9 }, surface: "desk" }),
    ];
    const spots = computeUsualSpots(sightings);
    expect(spots.map((spot) => spot.samples)).toEqual([3, 3]);
  });

  it("caps the list at five", () => {
    const sightings = Array.from({ length: 6 }, (_, i) =>
      sighting(i * HOUR, {
        sentence: `place ${i}`,
        room: { id: null, name: `room${i}`, confidence: 0.9 },
      }),
    );
    const spots = computeUsualSpots(sightings, { minShare: 0, max: 5 });
    expect(spots).toHaveLength(5);
    expect(spots.every((spot) => spot.samples === 1 && spot.share === 1 / 6)).toBe(true);
  });
});
