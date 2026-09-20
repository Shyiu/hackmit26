import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedFrameObservation, seedPerson } from "@memory-glasses/db/observations";
import { DELETE, PATCH } from "@/app/api/people/[id]/route";
import { GET } from "@/app/api/people/route";
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

// Listing, renaming, and removing read and write Mongo directly: the perception
// service enrolls people there, and the web app shouldn't need to reach it to
// show them (on Vercel it can't).
describe("/api/people without the perception service", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let household: Awaited<ReturnType<typeof newHousehold>>;

  beforeAll(async () => {
    env = await openRouteDb();
    household = await newHousehold(env.db);
  });
  afterAll(() => env.close());

  const auth = () => ({ cookie: household.cookie });

  it("lists enrolled people with their last match", async () => {
    const maria = await seedPerson(env.db, { patientId: household.patient._id, name: "Maria", relation: "daughter", photos: 3 });
    const seenAt = new Date(Date.now() - 60_000);
    await seedFrameObservation(env.db, {
      patientId: household.patient._id,
      capturedAt: seenAt,
      faces: [{ personId: maria._id, matchConfidence: 0.62 }],
    });

    const response = await call(GET, { method: "GET", path: "/api/people", params: {}, auth: auth() });
    expect(response.status).toBe(200);
    const { people } = (await response.json()) as { people: Record<string, unknown>[] };
    expect(people).toEqual([
      expect.objectContaining({
        id: maria._id.toHexString(),
        name: "Maria",
        relation: "daughter",
        photos: 3,
        lastSeenAt: seenAt.toISOString(),
        lastMatchConfidence: 0.62,
      }),
    ]);
    expect(people[0]).not.toHaveProperty("faceEmbeddings");
  });

  it("renames and removes a person", async () => {
    const person = await seedPerson(env.db, { patientId: household.patient._id, name: "Sam" });
    const id = person._id.toHexString();

    const renamed = await call(PATCH, {
      method: "PATCH",
      path: `/api/people/${id}`,
      params: { id },
      body: { name: "Samuel", relation: "son" },
      auth: auth(),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual(expect.objectContaining({ id, name: "Samuel", relation: "son" }));

    const removed = await call(DELETE, { method: "DELETE", path: `/api/people/${id}`, params: { id }, auth: auth() });
    expect(removed.status).toBe(204);
    const again = await call(DELETE, { method: "DELETE", path: `/api/people/${id}`, params: { id }, auth: auth() });
    expect(again.status).toBe(404);
  });

  it("404s a rename of a person who isn't yours", async () => {
    const other = await newHousehold(env.db);
    const person = await seedPerson(env.db, { patientId: other.patient._id, name: "Maria" });
    const id = person._id.toHexString();
    const response = await call(PATCH, {
      method: "PATCH",
      path: `/api/people/${id}`,
      params: { id },
      body: { name: "Nope" },
      auth: auth(),
    });
    expect(response.status).toBe(404);
    expect((await other.repos.people.get(person._id))?.name).toBe("Maria");
  });
});
