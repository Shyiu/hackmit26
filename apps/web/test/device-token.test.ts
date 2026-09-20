import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as ask } from "@/app/api/ask/route";
import { GET as listItems } from "@/app/api/items/route";
import { GET as getSettings } from "@/app/api/settings/route";
import { apiClaims, call, deviceToken, newHousehold, nowSeconds, openRouteDb } from "./helpers";

// Bearer device tokens on the web routes. Every refusal is a 401 with no hint
// about which check failed, and a refused request writes nothing.
describe("device tokens on the API", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let a: Awaited<ReturnType<typeof newHousehold>>;
  let b: Awaited<ReturnType<typeof newHousehold>>;

  beforeAll(async () => {
    env = await openRouteDb();
    a = await newHousehold(env.db);
    b = await newHousehold(env.db);
  });
  afterAll(() => env.close());

  const settingsWith = (bearer: string) => call(getSettings, { path: "/api/settings", auth: { bearer } });

  it("accepts a fresh api token for the device's own wearer", async () => {
    const token = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id }));
    const response = await call(listItems, { path: "/api/items", auth: { bearer: token } });
    expect(response.status).toBe(200);
  });

  it("refuses an expired token", async () => {
    const iat = nowSeconds() - 3600;
    const token = await deviceToken(
      apiClaims({ patientId: a.patient._id, deviceId: a.device._id, iat, exp: iat + 600 }),
    );
    expect((await settingsWith(token)).status).toBe(401);
  });

  it("refuses a token signed with the wrong secret", async () => {
    const token = await deviceToken(
      apiClaims({ patientId: a.patient._id, deviceId: a.device._id }),
      "some-other-secret-that-is-long-enough-0123456789",
    );
    expect((await settingsWith(token)).status).toBe(401);
  });

  it("refuses malformed tokens", async () => {
    const good = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id }));
    const [payload, signature] = good.split(".");
    for (const token of [
      "",
      "not-a-token",
      payload,
      `${payload}.`,
      `${payload}.${signature}.extra`,
      `${payload}.${signature.slice(0, -2)}`,
      `${payload.slice(0, -4)}.${signature}`,
      "!!!.???",
    ]) {
      expect((await settingsWith(token)).status, JSON.stringify(token)).toBe(401);
    }
  });

  it("refuses a token for another wearer, even when signed correctly", async () => {
    // A's device, but the claims name B's wearer: the device isn't in B's household.
    const crossed = await deviceToken(apiClaims({ patientId: b.patient._id, deviceId: a.device._id }));
    expect((await settingsWith(crossed)).status).toBe(401);
    const asked = await call(ask, {
      path: "/api/ask",
      body: { requestId: "x-1", transcript: "where are my keys" },
      auth: { bearer: crossed },
    });
    expect(asked.status).toBe(401);
    expect(await b.repos.interactions.listRecent()).toEqual([]);
    expect(await a.repos.interactions.listRecent()).toEqual([]);
  });

  it("refuses a token with no device, the wrong scope, a stale version, or a revoked device", async () => {
    const noDevice = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: null }));
    expect((await settingsWith(noDevice)).status).toBe(401);
    const frames = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id, scope: "frames" }));
    expect((await settingsWith(frames)).status).toBe(401);
    const stale = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id, tokenVersion: 7 }));
    expect((await settingsWith(stale)).status).toBe(401);
    const current = await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id }));
    expect((await settingsWith(current)).status).toBe(200);
    await a.repos.devices.revoke(a.device._id);
    expect((await settingsWith(current)).status).toBe(401);
  });
});
