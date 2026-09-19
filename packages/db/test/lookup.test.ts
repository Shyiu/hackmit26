import { describe, expect, it } from "vitest";
import { guessPlural, lookupCandidates, normalizeLookupKey } from "../src/lookup";

describe("normalizeLookupKey", () => {
  it.each([
    ["Car Keys", "car keys"],
    ["  car-keys!! ", "car keys"],
    ["Grandma's glasses", "grandmas glasses"],
    ["Grandma’s glasses", "grandmas glasses"],
    ["Café mug", "cafe mug"],
    ["TV   remote", "tv remote"],
    ["?!", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeLookupKey(input)).toBe(expected);
  });
});

describe("lookupCandidates", () => {
  it("returns every run of up to four words", () => {
    expect(lookupCandidates("Where are my car keys?")).toEqual(
      expect.arrayContaining(["car keys", "keys", "my car keys", "where are my car"]),
    );
    expect(lookupCandidates("Where are my car keys?")).not.toContain("where are my car keys");
  });

  it("is empty for a transcript with no words", () => {
    expect(lookupCandidates(" ... ")).toEqual([]);
  });
});

describe("guessPlural", () => {
  it.each([
    ["keys", true],
    ["glasses", true],
    ["hearing aids", true],
    ["wallet", false],
    ["glass", false],
    ["TV remote", false],
  ])("%s -> %s", (name, plural) => {
    expect(guessPlural(name)).toBe(plural);
  });
});
