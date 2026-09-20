import { describe, expect, it } from "vitest";
import { newId, type ItemDoc, type ItemId, type PatientId, type SightingDoc, type SightingId } from "@memory-glasses/db";
import { composeAnswer, composeItemAddedAnswer, isAffirmative } from "@/lib/server/answer";

const now = new Date("2026-01-10T12:00:00Z");

function item(overrides: Partial<ItemDoc> = {}): ItemDoc {
  return {
    _id: newId<ItemId>(),
    patientId: newId<PatientId>(),
    name: "keys",
    plural: true,
    aliases: [],
    lookupKeys: ["keys"],
    detectorPrompts: ["keys"],
    referenceImageKeys: [],
    active: true,
    observationVersion: 0,
    lastSighting: null,
    lastRestingSighting: null,
    usualSpots: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// describeItem only reads .sentence and .lastSeenAt off what lastDescribed
// returns, so the stub only needs to be shaped like a SightingDoc, not a
// fully valid one -- the real query is covered in packages/db/test/sightings.test.ts.
function describedSighting(overrides: { sentence: string; lastSeenAt: Date }): SightingDoc {
  return { _id: newId<SightingId>(), descriptionStatus: "ready", ...overrides } as SightingDoc;
}

/** A stub sightings repo: composeAnswer only ever calls lastDescribed. */
function sightingsStub(result: SightingDoc | null) {
  return { lastDescribed: async () => result };
}

describe("composeAnswer on a matched item", () => {
  it("answers with the last sighting the vision model actually described", async () => {
    const answer = await composeAnswer(
      { kind: "match", item: item(), matchedKey: "keys" },
      now,
      sightingsStub(describedSighting({ sentence: "on the hallway table", lastSeenAt: new Date(now.getTime() - 10_000) })),
    );
    expect(answer.template).toBe("fresh");
    expect(answer.text).toBe("I last saw your keys on the hallway table, just now.");
  });

  it("says unseen when nothing has ever been described, regardless of newer undescribed sightings", async () => {
    const answer = await composeAnswer(
      { kind: "match", item: item({ lastSighting: null }), matchedKey: "keys" },
      now,
      sightingsStub(null),
    );
    expect(answer.template).toBe("unseen");
    expect(answer.text).toBe("I haven't seen your keys in my available history.");
  });
});

describe("composeAnswer on an unresolved item", () => {
  it("offers to add it when the fast path guessed a name", async () => {
    const answer = await composeAnswer({ kind: "none", candidate: "flashlight" }, now, sightingsStub(null));
    expect(answer.template).toBe("offer_add_item");
    expect(answer.text).toBe("I haven't been tracking your flashlight. Want me to add it?");
    expect(answer.pendingItemName).toBe("flashlight");
  });

  it("falls back to the generic miss with nothing to guess from", async () => {
    const answer = await composeAnswer({ kind: "none", candidate: null }, now, sightingsStub(null));
    expect(answer.template).toBe("not_understood");
    expect(answer.text).toBe("Which thing should I look for?");
  });
});

describe("composeItemAddedAnswer", () => {
  it("confirms a singular item", () => {
    const answer = composeItemAddedAnswer(item({ name: "flashlight", plural: false }));
    expect(answer.text).toBe("Added your flashlight. I'll start watching for it.");
  });

  it("confirms a plural item", () => {
    const answer = composeItemAddedAnswer(item({ name: "keys", plural: true }));
    expect(answer.text).toBe("Added your keys. I'll start watching for them.");
  });
});

describe("isAffirmative", () => {
  it("accepts a short yes", () => {
    for (const reply of ["yes", "Yeah", "yep please", "sure", "ok", "add it", "please do it"]) {
      expect(isAffirmative(reply)).toBe(true);
    }
  });

  it("rejects a new question", () => {
    for (const reply of ["where are my keys", "no", "not now", "yesterday I saw my keys"]) {
      expect(isAffirmative(reply)).toBe(false);
    }
  });
});
