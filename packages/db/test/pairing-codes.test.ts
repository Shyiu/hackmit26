import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCaregiver } from "../src/accounts";
import { collection } from "../src/registry";
import { hashPairingCode, redeemPairingCode } from "../src/pairing";
import { newTenant, openTestDb } from "./helpers";

describe("pairing codes", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  let a: Awaited<ReturnType<typeof newTenant>>;
  let b: Awaited<ReturnType<typeof newTenant>>;

  beforeAll(async () => {
    env = await openTestDb();
    a = await newTenant(env.db);
    b = await newTenant(env.db);
  });

  afterAll(() => env.close());

  it("stores only the hash and redeems a code once", async () => {
    const caregiver = await createCaregiver(env.db, {
      email: "pairing-a@example.com",
      name: "Caregiver A",
      patientIds: [a.patientId],
    });
    const { pairingCode, code } = await a.pairingCodes.create({ createdBy: caregiver._id });
    expect(code).toMatch(/^\d{6}$/);
    expect(pairingCode.codeHash).toBe(hashPairingCode(code));
    expect((await collection(env.db, "pairingCodes").findOne({ _id: pairingCode._id }))?.codeHash).toBe(
      hashPairingCode(code),
    );

    await expect(redeemPairingCode(env.db, code)).resolves.toMatchObject({
      kind: "redeemed",
      pairingCode: { _id: pairingCode._id },
    });
    await expect(redeemPairingCode(env.db, code)).resolves.toEqual({ kind: "invalid" });
  });

  it("increments wrong attempts and burns a code after five guesses", async () => {
    const caregiver = await createCaregiver(env.db, {
      email: "pairing-wrong@example.com",
      name: "Caregiver",
      patientIds: [a.patientId],
    });
    const { pairingCode, code } = await a.pairingCodes.create({ createdBy: caregiver._id });
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(redeemPairingCode(env.db, "000000")).resolves.toEqual({ kind: "invalid" });
    }
    expect((await collection(env.db, "pairingCodes").findOne({ _id: pairingCode._id }))?.attempts).toBe(5);
    await expect(redeemPairingCode(env.db, code)).resolves.toEqual({ kind: "invalid" });
  });

  it("rejects an expired code", async () => {
    const caregiver = await createCaregiver(env.db, {
      email: "pairing-expired@example.com",
      name: "Caregiver",
      patientIds: [a.patientId],
    });
    const old = new Date(Date.now() - 11 * 60_000);
    const oldTenant = await newTenant(env.db, { now: () => old });
    const { code } = await oldTenant.pairingCodes.create({ createdBy: caregiver._id });
    await expect(redeemPairingCode(env.db, code)).resolves.toEqual({ kind: "invalid" });
  });

  it("lists only the current tenant's live codes", async () => {
    const caregiver = await createCaregiver(env.db, {
      email: "pairing-isolation@example.com",
      name: "Caregiver",
      patientIds: [a.patientId],
    });
    const { pairingCode } = await a.pairingCodes.create({ createdBy: caregiver._id });
    expect((await b.pairingCodes.listLive()).map((code) => code._id)).not.toContainEqual(pairingCode._id);
  });
});
