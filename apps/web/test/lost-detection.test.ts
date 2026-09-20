import { collection, newId, type CaptureSessionId } from "@memory-glasses/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as postLocation } from "@/app/api/location/route";
import { GET as nextNotification } from "@/app/api/notifications/route";
import { PATCH as patchSettings } from "@/app/api/settings/route";
import { checkLocationStaleness } from "@/lib/server/lost";
import { apiClaims, call, deviceToken, newHousehold, openRouteDb } from "./helpers";

describe("lost detection", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;

  beforeAll(async () => {
    env = await openRouteDb();
  });

  afterAll(() => env.close());

  it("stores device locations without a fence and does not alert", async () => {
    const a = await newHousehold(env.db);
    const token = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id }));
    const response = await call(postLocation, {
      method: "POST",
      path: "/api/location",
      body: {
        lat: 42.36,
        lng: -71.06,
        accuracy: null,
        capturedAt: "2025-01-01T12:00:00.000Z",
      },
      auth: { bearer: token },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ inside: null, distanceMeters: null, alerted: false });
    expect((await a.repos.patient.get())?.lastLocation).toMatchObject({
      lat: 42.36,
      lng: -71.06,
      accuracyMeters: null,
      inside: null,
      capturedAt: new Date("2025-01-01T12:00:00.000Z"),
    });
    expect(await a.repos.notifications.listRecent()).toEqual([]);
  });

  it("alerts once when a device leaves the approved area and never speaks it", async () => {
    const a = await newHousehold(env.db);
    const token = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id }));
    const patch = await call(patchSettings, {
      method: "PATCH",
      path: "/api/settings",
      body: { geofence: { lat: 42.36, lng: -71.06, radiusMeters: 200 } },
      auth: { cookie: a.cookie },
    });
    expect(patch.status).toBe(200);

    const inside = await call(postLocation, {
      method: "POST",
      path: "/api/location",
      body: { lat: 42.36, lng: -71.06, capturedAt: "2025-01-01T12:00:00.000Z" },
      auth: { bearer: token },
    });
    expect(inside.status).toBe(200);
    expect(await inside.json()).toMatchObject({ inside: true, alerted: false });

    const outsideBody = {
      lat: 42.36,
      lng: -71.054,
      capturedAt: "2025-01-01T12:00:01.000Z",
    };
    const outside = await call(postLocation, {
      method: "POST",
      path: "/api/location",
      body: outsideBody,
      auth: { bearer: token },
    });
    expect(outside.status).toBe(200);
    expect(await outside.json()).toMatchObject({ inside: false, alerted: true });

    const alerts = (await a.repos.notifications.listRecent()).filter((notification) => notification.kind === "lost_alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toMatch(/left the approved area/);

    const repeated = await call(postLocation, {
      method: "POST",
      path: "/api/location",
      body: { ...outsideBody, capturedAt: "2025-01-01T12:00:02.000Z" },
      auth: { bearer: token },
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ inside: false, alerted: false });
    expect(
      (await a.repos.notifications.listRecent()).filter((notification) => notification.kind === "lost_alert"),
    ).toHaveLength(1);

    const next = await call(nextNotification, {
      path: "/api/notifications",
      auth: { bearer: token },
    });
    expect(next.status).toBe(200);
    expect((await next.json()).notification).toBeNull();
  });

  it("alerts once for a stale live session but not for a fresh session without a location", async () => {
    const now = new Date("2025-01-01T12:00:00.000Z");
    const a = await newHousehold(env.db);
    const patch = await call(patchSettings, {
      method: "PATCH",
      path: "/api/settings",
      body: { geofence: { lat: 42.36, lng: -71.06, radiusMeters: 200 } },
      auth: { cookie: a.cookie },
    });
    expect(patch.status).toBe(200);
    const settings = (await a.repos.patient.get())!.settings;
    const staleAt = new Date(now.getTime() - 20 * 60_000);
    await collection(env.db, "patients").updateOne(
      { _id: a.patient._id },
      {
        $set: {
          lastLocation: {
            lat: 42.36,
            lng: -71.06,
            accuracyMeters: null,
            capturedAt: staleAt,
            receivedAt: staleAt,
            inside: true,
          },
        },
      },
    );
    await collection(env.db, "captureSessions").insertOne({
      _id: newId<CaptureSessionId>(),
      patientId: a.patient._id,
      deviceId: a.device._id,
      source: "headset",
      state: "live",
      startedAt: new Date(now.getTime() - 30 * 60_000),
      updatedAt: now,
      endedAt: null,
      lastFrameAt: null,
      lastSeq: 0,
      framesReceived: 0,
      framesDropped: 0,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    });

    const patient = await a.repos.patient.get();
    expect(await checkLocationStaleness(a.repos, settings, patient, now)).toBe(true);
    expect(await checkLocationStaleness(a.repos, settings, patient, now)).toBe(false);
    const alerts = (await a.repos.notifications.listRecent()).filter((notification) => notification.kind === "lost_alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toMatch(/No location from the phone for 15 minutes/);

    const fresh = await newHousehold(env.db);
    const freshPatch = await call(patchSettings, {
      method: "PATCH",
      path: "/api/settings",
      body: { geofence: { lat: 42.36, lng: -71.06, radiusMeters: 200 } },
      auth: { cookie: fresh.cookie },
    });
    expect(freshPatch.status).toBe(200);
    const freshSettings = (await fresh.repos.patient.get())!.settings;
    await collection(env.db, "captureSessions").insertOne({
      _id: newId<CaptureSessionId>(),
      patientId: fresh.patient._id,
      deviceId: fresh.device._id,
      source: "headset",
      state: "live",
      startedAt: new Date(now.getTime() - 5 * 60_000),
      updatedAt: now,
      endedAt: null,
      lastFrameAt: null,
      lastSeq: 0,
      framesReceived: 0,
      framesDropped: 0,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    });
    expect(await checkLocationStaleness(fresh.repos, freshSettings, await fresh.repos.patient.get(), now)).toBe(false);
    expect(
      (await fresh.repos.notifications.listRecent()).filter((notification) => notification.kind === "lost_alert"),
    ).toHaveLength(0);
  });
});
