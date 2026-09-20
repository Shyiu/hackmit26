import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as pair } from "@/app/api/devices/pair/route";
import { POST as createPairingCode } from "@/app/api/devices/pairing-codes/route";
import { POST as revoke } from "@/app/api/devices/[id]/revoke/route";
import { GET as getSettings } from "@/app/api/settings/route";
import { DEVICE_COOKIE } from "@/lib/server/auth";
import { call, newHousehold, openRouteDb } from "./helpers";

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? "";
  return header.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? null;
}

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

  it("pairs a phone, authenticates with only its cookie, and scopes it to one patient", async () => {
    const codeResponse = await call(createPairingCode, {
      method: "POST",
      path: "/api/devices/pairing-codes",
      body: { kind: "wear" },
      auth: { cookie: a.cookie },
    });
    expect(codeResponse.status).toBe(201);
    const { code } = await codeResponse.json();

    const paired = await call(pair, {
      method: "POST",
      path: "/api/devices/pair",
      body: { code, label: "Chest phone" },
    });
    expect(paired.status).toBe(201);
    const deviceCookie = cookieValue(paired, DEVICE_COOKIE);
    expect(deviceCookie).toBeTruthy();

    const settings = await call(getSettings, {
      path: "/api/settings",
      auth: { deviceCookie: deviceCookie! },
    });
    expect(settings.status).toBe(200);
    expect((await settings.json()).settings).toMatchObject({ timezone: "America/New_York" });

    const foreignSettings = await call(getSettings, {
      path: "/api/settings",
      auth: { deviceCookie: deviceCookie!, patientHeader: b.patient._id.toHexString() },
    });
    expect(foreignSettings.status).toBe(200);
    expect(await a.repos.devices.list()).toHaveLength(2);
  });

  it("rejects a second redemption and revokes the device cookie", async () => {
    const codeResponse = await call(createPairingCode, {
      method: "POST",
      path: "/api/devices/pairing-codes",
      body: { kind: "sim" },
      auth: { cookie: a.cookie },
    });
    const { code } = await codeResponse.json();
    const paired = await call(pair, {
      method: "POST",
      path: "/api/devices/pair",
      body: { code, label: "Simulator" },
    });
    const body = await paired.json();
    const deviceCookie = cookieValue(paired, DEVICE_COOKIE)!;
    const second = await call(pair, {
      method: "POST",
      path: "/api/devices/pair",
      body: { code, label: "Again" },
    });
    expect(second.status).toBe(401);

    const revoked = await call(revoke, {
      method: "POST",
      path: `/api/devices/${body.deviceId}/revoke`,
      params: { id: body.deviceId },
      auth: { cookie: a.cookie },
    });
    expect(revoked.status).toBe(200);
    expect(
      (
        await call(getSettings, {
          path: "/api/settings",
          auth: { deviceCookie },
        })
      ).status,
    ).toBe(401);
  });

  it("does not let another caregiver revoke the device", async () => {
    const device = (await a.repos.devices.list()).find((candidate) => !candidate.revokedAt)!;
    const response = await call(revoke, {
      method: "POST",
      path: `/api/devices/${device._id}/revoke`,
      params: { id: device._id.toHexString() },
      auth: { cookie: b.cookie },
    });
    expect(response.status).toBe(404);
    expect((await a.repos.devices.getActive(device._id))?._id.equals(device._id)).toBe(true);
  });
});
