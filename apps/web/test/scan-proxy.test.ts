import { afterEach, expect, it, vi } from "vitest";
import { slamFetch } from "@/lib/server/scan";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("authenticates a private preview while preserving frame headers and service authentication", async () => {
  vi.stubEnv("SPLAT_SLAM_URL", "https://scan.example.test");
  vi.stubEnv("SPLAT_SLAM_KEY", "test-service-key");
  vi.stubEnv("SPLAT_SLAM_PREVIEW_TOKEN", "test-preview-token");
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await slamFetch("/api/scenes/demo/frames", {
    method: "POST", headers: { "content-type": "image/jpeg", "x-session": "camera-1" },
    body: new Uint8Array([1, 2, 3]), stream: true,
  });
  const [url, request] = fetch.mock.calls[0];
  expect(url.searchParams.get("k")).toBe("test-service-key");
  expect(request.headers.get("x-daytona-preview-token")).toBe("test-preview-token");
  expect(request.headers.get("content-type")).toBe("image/jpeg");
  expect(request.headers.get("x-session")).toBe("camera-1");
});

it("supports a local service without Daytona authentication", async () => {
  vi.stubEnv("SPLAT_SLAM_URL", "http://127.0.0.1:8420");
  vi.stubEnv("SPLAT_SLAM_KEY", "");
  vi.stubEnv("SPLAT_SLAM_PREVIEW_TOKEN", "");
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await slamFetch("/api/scenes", { stream: true });
  const [url, request] = fetch.mock.calls[0];
  expect(url.search).toBe("");
  expect(request.headers.has("x-daytona-preview-token")).toBe(false);
});
