import { seedDangerEvent } from "@memory-glasses/db/observations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as postAcknowledged } from "@/app/api/danger-events/[id]/acknowledged/route";
import { GET as listDangerEvents } from "@/app/api/danger-events/route";
import { apiClaims, call, deviceToken, newHousehold, openRouteDb } from "./helpers";

describe("/api/danger-events", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let home: Awaited<ReturnType<typeof newHousehold>>;
  let openId: string;

  beforeAll(async () => {
    env = await openRouteDb();
    home = await newHousehold(env.db);
    const open = await seedDangerEvent(env.db, {
      patientId: home.patient._id,
      kind: "hot_surface_visible",
      hazardLabel: "stove",
      lastSeenAt: new Date(),
    });
    openId = open._id.toHexString();
    await seedDangerEvent(env.db, {
      patientId: home.patient._id,
      kind: "unknown_face",
      status: "dismissed",
      lastSeenAt: new Date(Date.now() - 60_000),
    });
  });
  afterAll(() => env.close());

  const asCaregiver = () => ({ cookie: home.cookie });

  it("lists events as JSON with string ids and ISO dates", async () => {
    const response = await call(listDangerEvents, { path: "/api/danger-events", auth: asCaregiver() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dangerEvents).toHaveLength(2);
    expect(body.dangerEvents[0]._id).toBe(openId);
    expect(body.dangerEvents[0].hazardLabel).toBe("stove");
    expect(typeof body.dangerEvents[0].firstSeenAt).toBe("string");
    expect(body.dangerEvents[0]).not.toHaveProperty("patientId");
  });

  it("filters by status and rejects an unknown one", async () => {
    const open = await (
      await call(listDangerEvents, { path: "/api/danger-events?status=open", auth: asCaregiver() })
    ).json();
    expect(open.dangerEvents.map((event: { _id: string }) => event._id)).toEqual([openId]);
    const bad = await call(listDangerEvents, { path: "/api/danger-events?status=bogus", auth: asCaregiver() });
    expect(bad.status).toBe(400);
  });

  it("is caregiver-only", async () => {
    const token = await deviceToken(apiClaims({ patientId: home.patient._id, deviceId: home.device._id }));
    const response = await call(listDangerEvents, { path: "/api/danger-events", auth: { bearer: token } });
    expect(response.status).toBe(403);
  });

  it("acknowledges an open event once, then answers 409", async () => {
    const first = await call(postAcknowledged, {
      method: "POST",
      path: `/api/danger-events/${openId}/acknowledged`,
      params: { id: openId },
      auth: asCaregiver(),
    });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.status).toBe("acknowledged");
    expect(body.acknowledgedBy).toBe(home.caregiver._id.toHexString());
    expect(typeof body.acknowledgedAt).toBe("string");

    const second = await call(postAcknowledged, {
      method: "POST",
      path: `/api/danger-events/${openId}/acknowledged`,
      params: { id: openId },
      auth: asCaregiver(),
    });
    expect(second.status).toBe(409);
  });
});
