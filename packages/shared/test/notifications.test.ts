import { describe, expect, it } from "vitest";
import { updateItemSchema } from "../src/schemas/item";
import { caregiverNotificationSchema } from "../src/schemas/notification";

describe("caregiverNotificationSchema", () => {
  it("accepts the human-authored kinds", () => {
    for (const kind of ["caregiver_message", "reminder"]) {
      expect(caregiverNotificationSchema.safeParse({ kind, text: "Take your pills" }).success).toBe(true);
    }
  });

  it("rejects system kinds a caregiver must not mint", () => {
    for (const kind of ["danger_alert", "person_recognized"]) {
      expect(caregiverNotificationSchema.safeParse({ kind, text: "fake alert" }).success).toBe(false);
    }
  });
});

describe("updateItemSchema", () => {
  it("treats a null expectedUpdatedAt like an absent one", () => {
    const parsed = updateItemSchema.safeParse({ name: "keys", expectedUpdatedAt: null });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.expectedUpdatedAt).toBeNull();
  });

  it("still parses a real timestamp", () => {
    const parsed = updateItemSchema.safeParse({ expectedUpdatedAt: "2026-01-01T12:00:00Z" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.expectedUpdatedAt).toBeInstanceOf(Date);
  });
});
