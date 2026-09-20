import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDevicePairingCode,
  redeemDevicePairingCode,
} from "../src";
import { newTenant, openTestDb } from "./helpers";

const MINUTE = 60 * 1000;

describe("device pairing codes", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;

  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("redeems a code once", async () => {
    const tenant = await newTenant(env.db);
    const created = await createDevicePairingCode(env.db, tenant.patientId, "headset");
    const redeemed = await redeemDevicePairingCode(env.db, created.code);
    expect(redeemed.kind).toBe("redeemed");
    expect(redeemed.kind === "redeemed" && redeemed.pairingCode._id.equals(created.pairingCode._id)).toBe(true);
    expect((await redeemDevicePairingCode(env.db, created.code)).kind).toBe("invalid");
  });

  it("burns a live code after five wrong guesses", async () => {
    const tenant = await newTenant(env.db);
    const created = await createDevicePairingCode(env.db, tenant.patientId, "simulator");
    const wrongCode = created.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await redeemDevicePairingCode(env.db, wrongCode)).kind).toBe("invalid");
    }
    expect((await redeemDevicePairingCode(env.db, created.code)).kind).toBe("invalid");
  });

  it("rejects an expired code", async () => {
    const tenant = await newTenant(env.db);
    const now = new Date("2026-01-01T00:00:00Z");
    const created = await createDevicePairingCode(env.db, tenant.patientId, "headset", now);
    expect((await redeemDevicePairingCode(env.db, created.code, new Date(now.getTime() + 10 * MINUTE))).kind).toBe(
      "invalid",
    );
  });
});
