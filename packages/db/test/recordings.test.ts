import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collection } from "../src/registry";
import { sweepExpired } from "../src/retention";
import { fixedClock, newTenant, openTestDb } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

const newRecording = (sessionId = "phone-1") => ({
  sessionId,
  startedAt: new Date("2026-09-01T12:00:00Z"),
  mimeType: "video/mp4",
  width: 1280,
  height: 720,
  hasAudio: false,
});

describe("recordings", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("registers a recording once per phone session and expires it with retention", async () => {
    const tenant = await newTenant(env.db, { retentionDays: 7 });
    const first = await tenant.recordings.create(newRecording());
    const again = await tenant.recordings.create(newRecording());
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.recording._id.equals(first.recording._id)).toBe(true);
    expect(first.recording.expiresAt.getTime()).toBe(first.recording.startedAt.getTime() + 7 * DAY_MS);
    expect(first.recording.endedAt).toBeNull();
    expect(first.recording.chunks).toEqual([]);
  });

  it("gives a retried chunk the same key instead of a second object", async () => {
    const tenant = await newTenant(env.db);
    const { recording } = await tenant.recordings.create(newRecording());
    const chunk = { seq: 0, startedAt: recording.startedAt, durationMs: 10_000, bytes: 1_000_000 };

    const added = await tenant.recordings.addChunk(recording._id, chunk);
    const retried = await tenant.recordings.addChunk(recording._id, chunk);
    expect(added.kind).toBe("added");
    expect(retried.kind).toBe("existing");
    if (added.kind === "missing" || retried.kind === "missing") throw new Error("unreachable");
    expect(retried.chunk.key).toBe(added.chunk.key);
    expect(added.chunk.key).toMatch(
      new RegExp(`^recordings/${tenant.patientId.toHexString()}/${recording._id.toHexString()}/00000$`),
    );
    expect(retried.recording.chunks).toHaveLength(1);
    expect(retried.recording.endedAt).toBeNull();
  });

  it("closes the recording on its final chunk", async () => {
    const tenant = await newTenant(env.db);
    const { recording } = await tenant.recordings.create(newRecording());
    await tenant.recordings.addChunk(recording._id, {
      seq: 0,
      startedAt: recording.startedAt,
      durationMs: 10_000,
      bytes: 10,
    });
    const last = await tenant.recordings.addChunk(
      recording._id,
      { seq: 1, startedAt: new Date(recording.startedAt.getTime() + 10_000), durationMs: 4_000, bytes: 10 },
      { final: true },
    );
    if (last.kind !== "added") throw new Error(`expected added, got ${last.kind}`);
    expect(last.recording.endedAt?.toISOString()).toBe("2026-09-01T12:00:14.000Z");
    expect(last.recording.chunks.map((chunk) => chunk.seq)).toEqual([0, 1]);
  });

  it("does not see another wearer's recording", async () => {
    const owner = await newTenant(env.db);
    const other = await newTenant(env.db);
    const { recording } = await owner.recordings.create(newRecording());
    expect(await other.recordings.get(recording._id)).toBeNull();
    expect(await other.recordings.addChunk(recording._id, { seq: 0, startedAt: new Date(), durationMs: 1, bytes: 1 })).toEqual({
      kind: "missing",
    });
    expect((await owner.recordings.listRecent()).map((each) => each._id.toHexString())).toEqual([
      recording._id.toHexString(),
    ]);
  });

  it("is swept with its chunk objects once retention passes", async () => {
    const clock = fixedClock(new Date("2026-09-01T12:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now, retentionDays: 1 });
    const { recording } = await tenant.recordings.create(newRecording());
    await tenant.recordings.addChunk(recording._id, { seq: 0, startedAt: clock.now(), durationMs: 1000, bytes: 1 });
    clock.advance(2 * DAY_MS);

    const deleted: string[] = [];
    await sweepExpired(env.db, { now: clock.now(), deleteObjects: async (keys) => void deleted.push(...keys) });
    expect(deleted).toEqual([`recordings/${tenant.patientId.toHexString()}/${recording._id.toHexString()}/00000`]);
    expect(await collection(env.db, "recordings").findOne({ _id: recording._id })).toBeNull();
  });
});
