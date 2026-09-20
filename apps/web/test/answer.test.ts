import { describe, expect, it } from "vitest";
import { DEFAULT_PATIENT_SETTINGS, newId, type ItemDoc, type ItemId, type PatientId } from "@memory-glasses/db";
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

const spot = { sentence: "on the kitchen counter", share: 0.8, samples: 4, source: "history" as const };

function snapshot(overrides: Partial<NonNullable<ItemDoc["lastSighting"]>> = {}): ItemDoc["lastSighting"] {
  return {
    sightingId: newId(),
    observationVersion: 1,
    keyframeRevision: 1,
    state: "resting",
    descriptionStatus: "ready",
    sentence: "on the hallway table",
    room: "hallway",
    lastSeenAt: new Date(now.getTime() - 60 * 60_000),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    thumbKey: null,
    source: "simulator",
    ...overrides,
  };
}

const describe_ = (doc: ItemDoc) => composeAnswer({ kind: "match", item: doc, matchedKey: "keys" }, DEFAULT_PATIENT_SETTINGS, now);

describe("composeAnswer usual-spot suggestion", () => {
  it("suggests the usual spot on stale, held, uncertain, and unseen answers", () => {
    expect(describe_(item({ usualSpots: [spot] })).text).toBe(
      "I haven't seen your keys in my available history. It's usually on the kitchen counter.",
    );
    const stale = describe_(item({ usualSpots: [spot], lastSighting: snapshot() }));
    expect(stale.template).toBe("stale");
    expect(stale.text).toContain("It's usually on the kitchen counter.");
    const heldNoDescription = describe_(
      item({ usualSpots: [spot], lastSighting: snapshot({ state: "held", descriptionStatus: "pending", sentence: null }) }),
    );
    expect(heldNoDescription.template).toBe("unknown");
    expect(heldNoDescription.text).toContain("It's usually on the kitchen counter.");
    const uncertain = describe_(
      item({ usualSpots: [spot], lastSighting: snapshot({ descriptionStatus: "pending", sentence: null }) }),
    );
    expect(uncertain.template).toBe("unknown");
    expect(uncertain.text).toContain("It's usually on the kitchen counter.");
  });

  it("stays quiet on fresh answers and on weak history", () => {
    const fresh = describe_(
      item({ usualSpots: [spot], lastSighting: snapshot({ lastSeenAt: new Date(now.getTime() - 60_000) }) }),
    );
    expect(fresh.template).toBe("fresh");
    expect(fresh.text).not.toContain("usually");
    // Below the share and sample floors.
    const weak = describe_(
      item({ usualSpots: [{ ...spot, share: 0.3 }], lastSighting: snapshot({ state: "held" }) }),
    );
    expect(weak.text).not.toContain("usually");
    const few = describe_(
      item({ usualSpots: [{ ...spot, samples: 2 }], lastSighting: snapshot({ state: "held" }) }),
    );
    expect(few.text).not.toContain("usually");
  });

  it("answers from the described frame regardless of held or moving state", () => {
    const recent = { lastSeenAt: new Date(now.getTime() - 10_000) };
    const held = describe_(item({ lastSighting: snapshot({ state: "held", ...recent }) }));
    expect(held.template).toBe("fresh");
    expect(held.text).toBe("I last saw your keys on the hallway table, just now.");
    const moving = describe_(item({ lastSighting: snapshot({ state: "moving", ...recent }) }));
    expect(moving.template).toBe("fresh");
    expect(moving.text).toBe("I last saw your keys on the hallway table, just now.");
  });
});

describe("composeAnswer on an unresolved item", () => {
  it("offers to add it when the fast path guessed a name", () => {
    const answer = composeAnswer({ kind: "none", candidate: "flashlight" }, DEFAULT_PATIENT_SETTINGS, now);
    expect(answer.template).toBe("offer_add_item");
    expect(answer.text).toBe("I haven't been tracking your flashlight. Want me to add it?");
    expect(answer.pendingItemName).toBe("flashlight");
  });

  it("falls back to the generic miss with nothing to guess from", () => {
    const answer = composeAnswer({ kind: "none", candidate: null }, DEFAULT_PATIENT_SETTINGS, now);
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
