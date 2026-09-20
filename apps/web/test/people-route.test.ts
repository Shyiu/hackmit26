import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/people/[id]/route";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { apiClaims, call, deviceToken, newHousehold, openRouteDb } from "./helpers";

// PATCH /api/people/:id validates everything before the perception service is
// called, so none of these need the service running.
describe("PATCH /api/people/:id", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let household: Awaited<ReturnType<typeof newHousehold>>;
  const id = "5eed00000000000000000001";

  beforeAll(async () => {
    env = await openRouteDb();
    household = await newHousehold(env.db);
  });
  afterAll(() => env.close());

  const auth = () => ({ cookie: household.cookie });

  it("rejects a malformed id with 404", async () => {
    const response = await call(PATCH, {
      method: "PATCH",
      path: "/api/people/not-an-id",
      params: { id: "not-an-id" },
      body: { name: "Alex" },
      auth: auth(),
    });
    expect(response.status).toBe(404);
  });

  it("rejects an empty body, an empty name, and an overlong name", async () => {
    for (const body of [{}, { name: "" }, { name: "x".repeat(61) }]) {
      const response = await call(PATCH, {
        method: "PATCH",
        path: `/api/people/${id}`,
        params: { id },
        body,
        auth: auth(),
      });
      expect(response.status).toBe(422);
    }
  });

  it("rejects more than five photos", async () => {
    const form = new FormData();
    for (let i = 0; i < 6; i++) {
      form.append("photos", new File([new Uint8Array(10)], `photo-${i}.jpg`, { type: "image/jpeg" }));
    }
    const request = new NextRequest(new URL(`/api/people/${id}`, "http://localhost"), {
      method: "PATCH",
      headers: { cookie: `${SESSION_COOKIE}=${household.cookie}` },
      body: form,
    });
    const response = await PATCH(request, { params: Promise.resolve({ id }) });
    expect(response.status).toBe(422);
  });

  it("rejects a device token with 403", async () => {
    const bearer = await deviceToken(apiClaims({ patientId: household.patient._id, deviceId: household.device._id }));
    const response = await call(PATCH, {
      method: "PATCH",
      path: `/api/people/${id}`,
      params: { id },
      body: { name: "Alex" },
      auth: { bearer },
    });
    expect(response.status).toBe(403);
  });
});
