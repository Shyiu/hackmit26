import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedObservation } from "../src/observations";
import { collection } from "../src/registry";
import { TenantCollection } from "../src/tenant-collection";
import { newTenant, openTestDb } from "./helpers";

// Every repository holds a TenantCollection, so a caregiver acting for wearer B
// gets null, not wearer A's document, from any id they guess or copy. These
// tests take real ids from tenant A and use them through tenant B's repos.
describe("tenant isolation", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  let a: Awaited<ReturnType<typeof newTenant>>;
  let b: Awaited<ReturnType<typeof newTenant>>;

  beforeAll(async () => {
    env = await openTestDb();
    a = await newTenant(env.db);
    b = await newTenant(env.db);
  });
  afterAll(() => env.close());

  it("items: another wearer's item can't be read, renamed, archived, or resolved", async () => {
    const keys = await a.items.create({ name: "keys", aliases: ["house keys"] });
    expect(await b.items.get(keys._id)).toBeNull();
    expect(await b.items.update(keys._id, { name: "stolen" })).toBeNull();
    expect(await b.items.setActive(keys._id, false)).toBeNull();
    expect((await b.items.list()).map((item) => item._id.toHexString())).not.toContain(keys._id.toHexString());
    expect((await b.items.resolve("where are my keys")).kind).not.toBe("found");
    expect((await a.items.get(keys._id))?.name).toBe("keys");
    // The same name in two households is two items, not a conflict.
    await expect(b.items.create({ name: "keys" })).resolves.toBeTruthy();
  });

  it("sightings: another wearer's sightings are invisible by id and by item", async () => {
    const wallet = await a.items.create({ name: "wallet" });
    const { sighting } = await seedObservation(env.db, {
      patientId: a.patientId,
      itemId: wallet._id,
      label: "wallet",
      lastSeenAt: new Date(),
      state: "resting",
      description: { status: "ready", sentence: "on the desk", room: "office" },
    });
    expect(await b.sightings.get(sighting._id)).toBeNull();
    expect(await b.sightings.list({ itemId: wallet._id })).toEqual([]);
    expect(await b.sightings.list()).toEqual([]);
    expect((await a.sightings.get(sighting._id))?._id.equals(sighting._id)).toBe(true);
  });

  it("interactions: another wearer's question can't be read, finished, or given playback", async () => {
    const { interaction } = await a.interactions.begin({ requestId: "q-1", transcript: "where is my wallet" });
    expect(await b.interactions.get(interaction._id)).toBeNull();
    expect(await b.interactions.transition(interaction._id, "complete", { answerText: "nowhere" })).toBeNull();
    expect(await b.interactions.recordPlayback(interaction._id, { outcome: "played" })).toBeNull();
    expect(await b.interactions.listRecent()).toEqual([]);
    // The same requestId from another household starts its own interaction.
    const own = await b.interactions.begin({ requestId: "q-1", transcript: "where is my wallet" });
    expect(own.created).toBe(true);
    expect(own.interaction._id.equals(interaction._id)).toBe(false);
    expect((await a.interactions.get(interaction._id))?.status).toBe("generating");
  });

  it("notifications: another wearer's message can't be shown or listed", async () => {
    const note = await a.notifications.create({ kind: "caregiver_message", text: "Lunch is in the fridge" });
    expect(await b.notifications.markShown(note._id)).toBeNull();
    expect(await b.notifications.nextDue()).toBeNull();
    expect(await b.notifications.listRecent()).toEqual([]);
    expect((await a.notifications.nextDue())?._id.equals(note._id)).toBe(true);
  });

  it("rooms: another wearer's room can't be read or renamed", async () => {
    const kitchen = await a.rooms.create({ name: "Kitchen" });
    expect(await b.rooms.update(kitchen._id, { name: "Pantry" })).toBeNull();
    expect(await b.rooms.list()).toEqual([]);
    expect((await a.rooms.list()).map((room) => room.name)).toEqual(["Kitchen"]);
    await expect(b.rooms.create({ name: "Kitchen" })).resolves.toBeTruthy();
  });

  it("devices: another wearer's device can't be looked up, touched, or revoked", async () => {
    const headset = await a.devices.register({ kind: "headset", label: "Phone" });
    expect(await b.devices.getActive(headset._id)).toBeNull();
    await b.devices.touch(headset._id);
    expect(await b.devices.revoke(headset._id)).toBeNull();
    expect(await b.devices.list()).toEqual([]);
    const stored = await collection(env.db, "devices").findOne({ _id: headset._id });
    expect(stored?.revokedAt).toBeNull();
    expect(stored?.lastSeenAt).toBeNull();
  });

  it("patient: settings and capture state stay with their own wearer", async () => {
    await a.patient.updateSettings({ retentionDays: 3 });
    expect((await b.patient.get())?.settings.retentionDays).toBe(30);
    expect(await b.patient.latestCaptureSession()).toBeNull();
  });

  it("TenantCollection refuses an insert for another wearer and pins every filter", async () => {
    const asB = new TenantCollection(collection(env.db, "rooms"), b.patientId);
    const [kitchen] = await a.rooms.list();
    if (!kitchen) throw new Error("expected the room created above");
    expect(() => asB.insertOne({ ...kitchen, patientId: a.patientId })).toThrow(/another wearer/);
    // A caller can't widen the scope by naming patientId in the filter.
    const theirs = { _id: kitchen._id, patientId: a.patientId };
    expect(await asB.findOne(theirs)).toBeNull();
    expect(await asB.countDocuments(theirs)).toBe(0);
    expect(await asB.find(theirs).toArray()).toEqual([]);
    expect(await asB.aggregate([{ $match: theirs }]).toArray()).toEqual([]);
    const updated = await asB.updateOne({ _id: kitchen._id, patientId: a.patientId }, { $set: { name: "Nope" } });
    expect(updated.matchedCount).toBe(0);
    const deleted = await asB.deleteMany(theirs);
    expect(deleted.deletedCount).toBe(0);
    expect((await a.rooms.list())[0]?.name).toBe("Kitchen");
  });
});
