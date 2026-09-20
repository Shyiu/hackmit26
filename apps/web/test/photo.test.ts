import { describe, expect, it } from "vitest";
import { photoBudget, shrinkFormPhotos } from "@/lib/client/photo";

describe("photo uploads", () => {
  it("splits the upload budget across the photos", () => {
    expect(photoBudget(1)).toBeGreaterThan(photoBudget(5));
    expect(photoBudget(5) * 5).toBeLessThanOrEqual(photoBudget(1));
    expect(photoBudget(0)).toBe(photoBudget(1));
  });

  it("leaves the form alone when the browser can't resize", async () => {
    // No canvas here, which is the same situation as a browser that can't decode the file.
    const body = new FormData();
    body.set("name", "Maria");
    body.append("photos", new File(["x"], "a.png", { type: "image/png" }));
    await shrinkFormPhotos(body);
    const photos = body.getAll("photos");
    expect(photos).toHaveLength(1);
    expect((photos[0] as File).name).toBe("a.png");
    expect(body.get("name")).toBe("Maria");
  });
});
