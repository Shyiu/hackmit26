import { addPatientToCaregiver, createPatient, tenantRepos } from "@memory-glasses/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as selectPatient } from "@/app/api/auth/select-patient/route";
import { GET as listItems } from "@/app/api/items/route";
import { createSessionToken } from "@/lib/server/auth";
import { call, newHousehold, openRouteDb } from "./helpers";

describe("patient selection", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let a: Awaited<ReturnType<typeof newHousehold>>;
  let b: Awaited<ReturnType<typeof newHousehold>>;
  let secondPatient: Awaited<ReturnType<typeof createPatient>>;
  let multiPatientCookie: string;

  beforeAll(async () => {
    env = await openRouteDb();
    a = await newHousehold(env.db);
    b = await newHousehold(env.db);
    secondPatient = await createPatient(env.db, { displayName: "Second wearer" });
    const attached = await addPatientToCaregiver(env.db, a.caregiver._id, secondPatient._id);
    if (attached.kind !== "attached") throw new Error("failed to attach second wearer");
    multiPatientCookie = await createSessionToken(attached.caregiver);
    await tenantRepos(env.db, secondPatient._id).items.create({ name: "second wearer's keys" });
  });

  afterAll(() => env.close());

  it("defaults to the first wearer and switches to an attached wearer", async () => {
    const initial = await call(listItems, { path: "/api/items", auth: { cookie: multiPatientCookie } });
    expect(initial.status).toBe(200);
    expect((await initial.json()).items).toEqual([]);

    const selected = await call(selectPatient, {
      method: "POST",
      path: "/api/auth/select-patient",
      body: { patientId: secondPatient._id.toHexString() },
      auth: { cookie: multiPatientCookie },
    });
    expect(selected.status).toBe(200);
    expect((await selected.json()).patientId).toBe(secondPatient._id.toHexString());
    expect(selected.headers.get("set-cookie")).toContain("mg_patient=");

    const items = await call(listItems, {
      path: "/api/items",
      auth: { cookie: multiPatientCookie, patientCookie: secondPatient._id.toHexString() },
    });
    expect((await items.json()).items.map((item: { name: string }) => item.name)).toEqual(["second wearer's keys"]);
  });

  it("rejects another caregiver's wearer without setting a selection cookie", async () => {
    const response = await call(selectPatient, {
      method: "POST",
      path: "/api/auth/select-patient",
      body: { patientId: b.patient._id.toHexString() },
      auth: { cookie: multiPatientCookie },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("falls back from a stale selection to the first wearer", async () => {
    const response = await call(listItems, {
      path: "/api/items",
      auth: { cookie: multiPatientCookie, patientCookie: b.patient._id.toHexString() },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([]);
  });
});
