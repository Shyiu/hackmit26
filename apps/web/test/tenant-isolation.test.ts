import { seedObservation } from "@memory-glasses/db/observations";
import { ObjectId } from "@memory-glasses/db";
import { GridFSBucket } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getCapture } from "@/app/api/capture/route";
import { GET as getInteraction } from "@/app/api/interactions/[id]/route";
import { POST as postPlayback } from "@/app/api/interactions/[id]/playback/route";
import { GET as listInteractions } from "@/app/api/interactions/route";
import { PATCH as patchItem } from "@/app/api/items/[id]/route";
import { POST as recomputeUsualSpots } from "@/app/api/items/[id]/usual-spots/route";
import { GET as listItems } from "@/app/api/items/route";
import { POST as postShown } from "@/app/api/notifications/[id]/shown/route";
import { GET as nextNotification } from "@/app/api/notifications/route";
import { GET as getFrameToken } from "@/app/api/perception/token/route";
import { PATCH as patchRoom } from "@/app/api/rooms/[id]/route";
import { GET as listRooms } from "@/app/api/rooms/route";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/settings/route";
import { GET as listSightings } from "@/app/api/sightings/route";
import { GET as getKeyframe } from "@/app/api/sightings/[id]/keyframe/route";
import { GET as getThumb } from "@/app/api/sightings/[id]/thumb/route";
import { call, newHousehold, openRouteDb } from "./helpers";

// Two households, A and B. Everything B's caregiver or device tries against A's
// ids has to come back 404 (or an empty list), and nothing of A's may change.
describe("API tenant isolation", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let a: Awaited<ReturnType<typeof newHousehold>>;
  let b: Awaited<ReturnType<typeof newHousehold>>;
  let ids: { item: string; sighting: string; interaction: string; notification: string; room: string };

  beforeAll(async () => {
    env = await openRouteDb();
    a = await newHousehold(env.db);
    b = await newHousehold(env.db);
    const item = await a.repos.items.create({ name: "keys" });
    const { sighting } = await seedObservation(env.db, {
      patientId: a.patient._id,
      itemId: item._id,
      label: "keys",
      lastSeenAt: new Date(),
      state: "resting",
      description: { status: "ready", sentence: "on the hook", room: "hall" },
    });
    const keyframeKey = `test/${sighting._id.toHexString()}.jpg`;
    const thumbKey = `test/${sighting._id.toHexString()}.thumb.jpg`;
    await env.db.collection("sightings").updateOne(
      { _id: sighting._id },
      { $set: { keyframeKey, thumbKey } },
    );
    const bucket = new GridFSBucket(env.db, { bucketName: "keyframes" });
    for (const [key, bytes] of [
      [keyframeKey, Buffer.from("keyframe bytes")],
      [thumbKey, Buffer.from("thumb bytes")],
    ] as const) {
      const upload = bucket.openUploadStream(key);
      await new Promise<void>((resolve, reject) => {
        upload.once("error", reject);
        upload.once("finish", () => resolve());
        upload.end(bytes);
      });
    }
    const { interaction } = await a.repos.interactions.begin({ requestId: "a-1", transcript: "where are my keys" });
    const notification = await a.repos.notifications.create({ kind: "caregiver_message", text: "Lunch is ready" });
    const room = await a.repos.rooms.create({ name: "Kitchen" });
    ids = {
      item: item._id.toHexString(),
      sighting: sighting._id.toHexString(),
      interaction: interaction._id.toHexString(),
      notification: notification._id.toHexString(),
      room: room._id.toHexString(),
    };
  });
  afterAll(() => env.close());

  const asB = () => ({ cookie: b.cookie });
  const asA = () => ({ cookie: a.cookie });

  it("serves keyframes only to the sighting's caregiver", async () => {
    const foreignKeyframe = await call(getKeyframe, {
      path: `/api/sightings/${ids.sighting}/keyframe`,
      params: { id: ids.sighting },
      auth: asB(),
    });
    expect(foreignKeyframe.status).toBe(404);
    const foreignThumb = await call(getThumb, {
      path: `/api/sightings/${ids.sighting}/thumb`,
      params: { id: ids.sighting },
      auth: asB(),
    });
    expect(foreignThumb.status).toBe(404);

    const keyframe = await call(getKeyframe, {
      path: `/api/sightings/${ids.sighting}/keyframe`,
      params: { id: ids.sighting },
      auth: asA(),
    });
    expect(keyframe.status).toBe(200);
    expect(keyframe.headers.get("content-type")).toContain("image/jpeg");
    expect(Buffer.from(await keyframe.arrayBuffer()).toString()).toBe("keyframe bytes");

    const thumb = await call(getThumb, {
      path: `/api/sightings/${ids.sighting}/thumb`,
      params: { id: ids.sighting },
      auth: asA(),
    });
    expect(thumb.status).toBe(200);
    expect(Buffer.from(await thumb.arrayBuffer()).toString()).toBe("thumb bytes");

    await env.db.collection("sightings").updateOne(
      { _id: new ObjectId(ids.sighting) },
      { $set: { keyframeKey: null, thumbKey: null } },
    );
    expect(
      (await call(getKeyframe, {
        path: `/api/sightings/${ids.sighting}/keyframe`,
        params: { id: ids.sighting },
        auth: asA(),
      })).status,
    ).toBe(404);
    expect(
      (await call(getThumb, {
        path: `/api/sightings/${ids.sighting}/thumb`,
        params: { id: ids.sighting },
        auth: asA(),
      })).status,
    ).toBe(404);
  });

  it("lists show only the caller's own records", async () => {
    const items = await (await call(listItems, { path: "/api/items", auth: asB() })).json();
    expect(items.items).toEqual([]);
    const rooms = await (await call(listRooms, { path: "/api/rooms", auth: asB() })).json();
    expect(rooms.rooms).toEqual([]);
    const interactions = await (await call(listInteractions, { path: "/api/interactions", auth: asB() })).json();
    expect(interactions.interactions).toEqual([]);
    const notification = await (await call(nextNotification, { path: "/api/notifications", auth: asB() })).json();
    expect(notification.notification).toBeNull();
    const sightings = await (await call(listSightings, { path: "/api/sightings", auth: asB() })).json();
    expect(sightings.sightings).toEqual([]);
    const byItem = await (
      await call(listSightings, { path: `/api/sightings?itemId=${ids.item}`, auth: asB() })
    ).json();
    expect(byItem.sightings).toEqual([]);
    const capture = await (await call(getCapture, { path: "/api/capture", auth: asB() })).json();
    expect(capture.capture).toBeNull();
  });

  it("id-guessing against another wearer's item is a 404 and changes nothing", async () => {
    const response = await call(patchItem, {
      method: "PATCH",
      path: `/api/items/${ids.item}`,
      params: { id: ids.item },
      body: { name: "stolen" },
      auth: asB(),
    });
    expect(response.status).toBe(404);
    expect((await a.repos.items.list()).map((item) => item.name)).toEqual(["keys"]);
    const recompute = await call(recomputeUsualSpots, {
      method: "POST",
      path: `/api/items/${ids.item}/usual-spots`,
      params: { id: ids.item },
      auth: asB(),
    });
    expect(recompute.status).toBe(404);
  });

  it("another wearer's interaction can't be read or given playback", async () => {
    const read = await call(getInteraction, {
      path: `/api/interactions/${ids.interaction}`,
      params: { id: ids.interaction },
      auth: asB(),
    });
    expect(read.status).toBe(404);
    const playback = await call(postPlayback, {
      path: `/api/interactions/${ids.interaction}/playback`,
      params: { id: ids.interaction },
      body: { outcome: "played" },
      auth: asB(),
    });
    expect(playback.status).toBe(404);
  });

  it("another wearer's notification can't be marked shown", async () => {
    const response = await call(postShown, {
      path: `/api/notifications/${ids.notification}/shown`,
      params: { id: ids.notification },
      auth: asB(),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).notification).toBeNull();
    expect((await a.repos.notifications.nextDue())?._id.toHexString()).toBe(ids.notification);
  });

  it("another wearer's room can't be renamed", async () => {
    const response = await call(patchRoom, {
      method: "PATCH",
      path: `/api/rooms/${ids.room}`,
      params: { id: ids.room },
      body: { name: "Pantry" },
      auth: asB(),
    });
    expect(response.status).toBe(404);
    expect((await a.repos.rooms.list()).map((room) => room.name)).toEqual(["Kitchen"]);
  });

  it("malformed ids are a 404 too, not a 400 that confirms the format", async () => {
    const response = await call(getInteraction, {
      path: "/api/interactions/not-an-id",
      params: { id: "not-an-id" },
      auth: asB(),
    });
    expect(response.status).toBe(404);
  });

  it("a caregiver can't pick another wearer with the x-patient-id header", async () => {
    const response = await call(getSettings, {
      path: "/api/settings",
      auth: { cookie: b.cookie, patientHeader: a.patient._id.toHexString() },
    });
    expect(response.status).toBe(401);
    const patched = await call(patchSettings, {
      method: "PATCH",
      path: "/api/settings",
      body: { retentionDays: 1 },
      auth: { cookie: b.cookie, patientHeader: a.patient._id.toHexString() },
    });
    expect(patched.status).toBe(401);
    expect((await a.repos.patient.get())?.settings.retentionDays).toBe(30);
  });

  it("a frame token minted for B names B's wearer, whatever the caller sends", async () => {
    const response = await call(getFrameToken, {
      path: "/api/perception/token",
      auth: { cookie: b.cookie, patientHeader: b.patient._id.toHexString() },
    });
    expect(response.status).toBe(200);
    const { token } = await response.json();
    const claims = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(claims.pid).toBe(b.patient._id.toHexString());
    expect(claims.scope).toBe("frames");
  });
});
