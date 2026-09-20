import { describe, expect, it } from "vitest";
import { updatePersonSchema } from "../src/schemas/person";

describe("updatePersonSchema", () => {
  it("accepts a name, a relation, both, or a cleared relation", () => {
    expect(updatePersonSchema.safeParse({ name: "Alex" }).success).toBe(true);
    expect(updatePersonSchema.safeParse({ relation: "son" }).success).toBe(true);
    expect(updatePersonSchema.safeParse({ name: "Alex", relation: null }).success).toBe(true);
    expect(updatePersonSchema.safeParse({ name: "  Alex  " }).success).toBe(true);
  });

  it("rejects an empty body, empty name, overlong values, and extra keys", () => {
    expect(updatePersonSchema.safeParse({}).success).toBe(false);
    expect(updatePersonSchema.safeParse({ name: "" }).success).toBe(false);
    expect(updatePersonSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(updatePersonSchema.safeParse({ relation: "x".repeat(61) }).success).toBe(false);
    expect(updatePersonSchema.safeParse({ name: "Alex", role: "admin" }).success).toBe(false);
    expect(updatePersonSchema.safeParse({ name: 42 }).success).toBe(false);
  });
});
