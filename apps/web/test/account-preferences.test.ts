import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, PATCH } from "@/app/api/account/preferences/route";
import { apiClaims, call, deviceToken, newHousehold, openRouteDb } from "./helpers";

describe("caregiver account preferences", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let a: Awaited<ReturnType<typeof newHousehold>>;
  let b: Awaited<ReturnType<typeof newHousehold>>;

  beforeAll(async () => {
    env = await openRouteDb();
    a = await newHousehold(env.db);
    b = await newHousehold(env.db);
  });

  afterAll(() => env.close());

  it("defaults sound notifications to off", async () => {
    const response = await call(GET, { path: "/api/account/preferences", auth: { cookie: a.cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferences: { soundNotificationsEnabled: false } });
  });

  it("turns sound on for one caregiver only", async () => {
    const saved = await call(PATCH, {
      method: "PATCH",
      path: "/api/account/preferences",
      body: { soundNotificationsEnabled: true },
      auth: { cookie: a.cookie },
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).preferences.soundNotificationsEnabled).toBe(true);

    const again = await call(GET, { path: "/api/account/preferences", auth: { cookie: a.cookie } });
    expect((await again.json()).preferences.soundNotificationsEnabled).toBe(true);

    const other = await call(GET, { path: "/api/account/preferences", auth: { cookie: b.cookie } });
    expect((await other.json()).preferences.soundNotificationsEnabled).toBe(false);
  });

  it("rejects unknown fields and device tokens", async () => {
    const unknown = await call(PATCH, {
      method: "PATCH",
      path: "/api/account/preferences",
      body: { loud: true },
      auth: { cookie: a.cookie },
    });
    expect(unknown.status).toBe(400);

    const bearer = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id }));
    const device = await call(PATCH, {
      method: "PATCH",
      path: "/api/account/preferences",
      body: { soundNotificationsEnabled: true },
      auth: { bearer },
    });
    expect(device.status).toBe(403);
  });
});
