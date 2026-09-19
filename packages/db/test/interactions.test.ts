import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError, InvalidInputError } from "../src/errors";
import { collection } from "../src/registry";
import { tenantRepos } from "../src/repos";
import { fixedClock, newTenant, openTestDb } from "./helpers";

describe("interactions", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("deduplicates a retried request", async () => {
    const tenant = await newTenant(env.db);
    const first = await tenant.interactions.begin({ requestId: "req-1", transcript: "where are my keys" });
    const retry = await tenant.interactions.begin({ requestId: "req-1", transcript: "where are my keys" });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.interaction._id.equals(first.interaction._id)).toBe(true);
  });

  it("creates exactly one interaction when copies of a request race", async () => {
    // One client serializes enough that upserts rarely collide. Four pools
    // collide every round when request_unique is missing, which is the point.
    const tenant = await newTenant(env.db);
    const connections = await env.moreConnections(4);
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all(
        Array.from({ length: 16 }, (_, i) =>
          tenantRepos(connections[i % connections.length] ?? env.db, tenant.patientId).interactions.begin({
            requestId: `race-${round}`,
            transcript: "keys?",
          }),
        ),
      );
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.interaction._id.toHexString())).size).toBe(1);
    }
    expect(await collection(env.db, "interactions").countDocuments({ patientId: tenant.patientId })).toBe(5);
  });

  it("scopes request ids to the wearer", async () => {
    const alice = await newTenant(env.db);
    const bob = await newTenant(env.db);
    const a = await alice.interactions.begin({ requestId: "same", transcript: "keys?" });
    const b = await bob.interactions.begin({ requestId: "same", transcript: "wallet?" });

    expect(b.created).toBe(true);
    expect(a.interaction._id.equals(b.interaction._id)).toBe(false);
    expect(await bob.interactions.get(a.interaction._id)).toBeNull();
  });

  it("only moves status forward", async () => {
    const tenant = await newTenant(env.db);
    const { interaction } = await tenant.interactions.begin({ requestId: "r", transcript: "keys?" });

    const streaming = await tenant.interactions.transition(interaction._id, "streaming", {
      path: "fast",
      timingsMs: { intent: 2, db: 11 },
    });
    expect(streaming?.status).toBe("streaming");
    expect(streaming?.completedAt).toBeNull();

    const done = await tenant.interactions.transition(interaction._id, "complete", {
      answerText: "I last saw your keys on the kitchen counter.",
      answerTemplate: "fresh",
      timingsMs: { ttsFirstByte: 240, total: 820 },
    });
    expect(done?.completedAt).toBeInstanceOf(Date);
    expect(done?.timingsMs).toEqual({ intent: 2, db: 11, ttsFirstByte: 240, total: 820 });

    expect(await tenant.interactions.transition(interaction._id, "streaming")).toBeNull();
    expect(await tenant.interactions.transition(interaction._id, "cancelled")).toBeNull();
  });

  it("won't let a late completion overwrite a cancellation", async () => {
    const tenant = await newTenant(env.db);
    const { interaction } = await tenant.interactions.begin({ requestId: "r", transcript: "keys?" });
    await tenant.interactions.transition(interaction._id, "cancelled");

    expect(await tenant.interactions.transition(interaction._id, "complete", { answerText: "late" })).toBeNull();
    expect((await tenant.interactions.get(interaction._id))?.status).toBe("cancelled");
  });

  it("keeps the first playback report", async () => {
    const tenant = await newTenant(env.db);
    const { interaction } = await tenant.interactions.begin({ requestId: "r", transcript: "keys?" });

    await tenant.interactions.recordPlayback(interaction._id, { outcome: "played", clientFirstPlaybackMs: 310 });
    const again = await tenant.interactions.recordPlayback(interaction._id, { outcome: "failed" });
    expect(again?.playbackOutcome).toBe("played");
    expect(again?.timingsMs.clientFirstPlayback).toBe(310);
  });

  it("stores the transcript it validated", async () => {
    const tenant = await newTenant(env.db);
    const { interaction } = await tenant.interactions.begin({ requestId: "trim", transcript: "  where are my keys?  " });
    expect(interaction.transcript).toBe("where are my keys?");
  });

  it("rejects bad playback reports with a 400-class error", async () => {
    const tenant = await newTenant(env.db);
    const { interaction } = await tenant.interactions.begin({ requestId: "r", transcript: "keys?" });
    await expect(
      tenant.interactions.recordPlayback(interaction._id, { outcome: "played", clientFirstPlaybackMs: -5 }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("hides interactions past retention from every path", async () => {
    const clock = fixedClock(new Date("2026-09-01T12:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now, retentionDays: 1 });
    const { interaction } = await tenant.interactions.begin({ requestId: "old", transcript: "keys?" });
    await tenant.interactions.transition(interaction._id, "complete", { timingsMs: { db: 5 } });
    clock.advance(2 * 24 * 60 * 60 * 1000);

    expect(await tenant.interactions.get(interaction._id)).toBeNull();
    expect(await tenant.interactions.recordPlayback(interaction._id, { outcome: "played" })).toBeNull();
    await expect(tenant.interactions.begin({ requestId: "old", transcript: "keys?" })).rejects.toThrow(ConflictError);
    const stats = await tenant.interactions.latencyStats({ since: new Date("2026-08-01T00:00:00Z") });
    expect(stats.interactions).toBe(0);
  });

  it("computes stage percentiles over completed interactions", async () => {
    const clock = fixedClock(new Date("2026-09-19T15:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now });
    for (let i = 1; i <= 20; i++) {
      const { interaction } = await tenant.interactions.begin({ requestId: `r${i}`, transcript: "keys?" });
      await tenant.interactions.transition(interaction._id, "complete", { timingsMs: { db: i, total: 100 * i } });
      clock.advance(1_000);
    }
    const { interaction: failed } = await tenant.interactions.begin({ requestId: "failed", transcript: "keys?" });
    await tenant.interactions.transition(failed._id, "failed", { timingsMs: { db: 9_999 } });

    const stats = await tenant.interactions.latencyStats({ since: new Date("2026-09-19T00:00:00Z") });
    expect(stats.interactions).toBe(20);
    expect(stats.stages.db).toEqual({ samples: 20, p50: 10, p95: 19 });
    expect(stats.stages.total.p95).toBe(1_900);
    expect(stats.stages.stt).toEqual({ samples: 0, p50: null, p95: null });
  });
});
