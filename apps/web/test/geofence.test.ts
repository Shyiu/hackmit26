import { describe, expect, it } from "vitest";
import { haversineMeters, isInside, metersOutside } from "@/lib/geofence";

const fence = { lat: 0, lng: 0, radiusMeters: 50 };

describe("geofence geometry", () => {
  it("calculates distance on the earth", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 })).toBeCloseTo(111.2, 0);
  });

  it("subtracts the radius and accuracy allowance", () => {
    expect(metersOutside(fence, { lat: 0, lng: 0.0004 }, null)).toBeLessThanOrEqual(0);
    expect(metersOutside(fence, { lat: 0, lng: 0.00099 }, null)).toBeGreaterThan(0);
    expect(isInside(fence, { lat: 0, lng: 0.00054 }, 20)).toBe(true);
  });
});
