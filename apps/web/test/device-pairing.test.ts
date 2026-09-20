import { parseId, tenantRepos, type DeviceId } from "@memory-glasses/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listDevices } from "@/app/api/devices/route";
import { POST as pairDevice } from "@/app/api/devices/pair/route";
import { POST as createPairingCode } from "@/app/api/devices/pairing-codes/route";
import { POST as revokeDevice } from "@/app/api/devices/[id]/revoke/route";
import { GET as listItems } from "@/app/api/items/route";
import { GET as getSettings } from "@/app/api/settings/route";
import { apiClaims, call, deviceToken, newHousehold, openRouteDb } from "./helpers";

describe("device pairing", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let a: Awaited<ReturnType<typeof newHousehold>>;
  let b: Awaited<ReturnType<typeof newHousehold>>;

  beforeAll(async () => {
    env = await openRouteDb();
    a = await newHousehold(env.db);
    b = await newHousehold(env.db);
  });

  afterAll(() => env.close());

  async function mint() {
    const response = await call(createPairingCode, {
      method: "POST",
      path: "/api/devices/pairing-codes",
      auth: { cookie: a.cookie },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { code: string; expiresAt: string };
  }

  function pair(code: string, name = "Chest phone") {
    return call(pairDevice, {
      method: "POST",
      path: "/api/devices/pair",
      body: { code, name, kind: "headset" },
    });
  }

  it("only a caregiver can mint a code", async () => {
    const minted = await mint();
    expect(minted.code).toMatch(/^\d{6}$/);
    expect(Date.parse(minted.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(
      (
        await call(createPairingCode, {
          method: "POST",
          path: "/api/devices/pairing-codes",
          auth: { bearer: await deviceToken(apiClaims({ patientId: a.patient._id, deviceId: a.device._id })) },
        })
      ).status,
    ).toBe(403);
    expect((await call(createPairingCode, { method: "POST", path: "/api/devices/pairing-codes" })).status).toBe(401);
  });

  it("burns a code after five wrong guesses", async () => {
    const minted = await mint();
    const wrong = minted.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) expect((await pair(wrong)).status).toBe(401);
    expect((await pair(minted.code)).status).toBe(401);
  });

  it("redeems once and scopes the long-lived token to its wearer", async () => {
    const aItem = await a.repos.items.create({ name: "A keys" });
    await b.repos.items.create({ name: "B keys" });
    const minted = await mint();
    const response = await pair(minted.code);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { deviceId: string; token: string; expiresAt: string };
    expect(body.deviceId).toMatch(/^[0-9a-f]{24}$/);
    expect(body.token).toEqual(expect.any(String));
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect((await pair(minted.code)).status).toBe(401);

    const settings = await call(getSettings, { path: "/api/settings", auth: { bearer: body.token } });
    expect(settings.status).toBe(200);
    const items = await call(listItems, { path: "/api/items", auth: { bearer: body.token } });
    expect(items.status).toBe(200);
    const listed = (await items.json()).items as Array<{ _id: string; name: string }>;
    expect(listed.map((item) => item._id)).toContain(aItem._id.toHexString());
    expect(listed.map((item) => item.name)).not.toContain("B keys");
  });

  it("rejects expired codes and malformed bodies", async () => {
    const old = new Date(Date.now() - 11 * 60_000);
    const oldTenant = tenantRepos(env.db, a.patient._id, { now: () => old });
    const caregiverCode = await oldTenant.pairingCodes.create({ createdBy: a.caregiver._id });
    expect((await pair(caregiverCode.code)).status).toBe(401);
    expect(
      (
        await call(pairDevice, {
          method: "POST",
          path: "/api/devices/pair",
          body: { code: "12", name: "Phone", kind: "headset" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(pairDevice, {
          method: "POST",
          path: "/api/devices/pair",
          body: { code: "123456", kind: "headset" },
        })
      ).status,
    ).toBe(400);
  });

  it("isolates device listing and revocation by caregiver", async () => {
    const minted = await mint();
    const paired = await pair(minted.code);
    const { deviceId, token } = (await paired.json()) as { deviceId: string; token: string };
    const bDevices = await (await call(listDevices, { path: "/api/devices", auth: { cookie: b.cookie } })).json();
    expect(bDevices.devices.map((device: { _id: string }) => device._id)).not.toContain(deviceId);

    const cross = await call(revokeDevice, {
      method: "POST",
      path: `/api/devices/${deviceId}/revoke`,
      params: { id: deviceId },
      auth: { cookie: b.cookie },
    });
    expect(cross.status).toBe(404);
    expect((await a.repos.devices.getActive(parseId<DeviceId>(deviceId)!))?.revokedAt).toBeNull();

    const own = await call(revokeDevice, {
      method: "POST",
      path: `/api/devices/${deviceId}/revoke`,
      params: { id: deviceId },
      auth: { cookie: a.cookie },
    });
    expect(own.status).toBe(200);
    expect((await call(getSettings, { path: "/api/settings", auth: { bearer: token } })).status).toBe(401);
  });
});
