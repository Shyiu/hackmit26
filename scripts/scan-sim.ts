// A phone stand-in for the live room scan: signs in as the seeded caregiver, streams a
// folder of frames to /api/scan/live/frames in real time, and every 40th kept frame posts
// an observation for the next item, so arrows appear as the map grows.
//
//   pnpm scan:sim --frames <dir of jpg/png> [--fps 4] [--base http://localhost:3000]
//                 [--every 1] [--items keys,wallet]
//
// --every N sends every Nth file. --items picks items by name; the default is all of them.
// PNG frames go through ffmpeg, which has to be on PATH. Reads CAREGIVER_EMAIL and
// CAREGIVER_PASSWORD from apps/web/.env.local; the web app needs SPLAT_SLAM_URL set.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { ScanFrameResult, ScanLiveState } from "@memory-glasses/shared";
import { requireEnv } from "./lib/env";

const OBSERVE_EVERY_KEPT = 40;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function positive(name: string, fallback: number): number {
  const value = Number(arg(name) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function readJpeg(path: string): Buffer {
  if (extname(path).toLowerCase() !== ".png") return readFileSync(path);
  return execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-frames:v", "1", "-q:v", "3", "-f", "mjpeg", "pipe:1"], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function main() {
  const dir = arg("frames");
  if (!dir) throw new Error("Pass --frames <dir of jpg/png>");
  const fps = positive("fps", 4);
  const every = Math.round(positive("every", 1));
  const base = (arg("base") ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
  const wanted = arg("items")?.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);

  const files = readdirSync(resolve(dir))
    .filter((name) => /\.(jpe?g|png)$/i.test(name))
    .sort()
    .filter((_, index) => index % every === 0)
    .map((name) => join(resolve(dir), name));
  if (files.length === 0) throw new Error(`No .jpg or .png files in ${dir}`);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: requireEnv("CAREGIVER_EMAIL"), password: requireEnv("CAREGIVER_PASSWORD") }),
  });
  if (!login.ok) throw new Error(`Sign-in failed with ${login.status}: ${await login.text()}`);
  const cookie = login.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...init.headers, cookie } });
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  }

  const { items: all } = await api<{ items: { _id: string; name: string }[] }>("/api/items");
  const items = wanted ? all.filter((item) => wanted.includes(item.name.toLowerCase())) : all;
  if (items.length === 0) console.warn("No matching items, so no observations will be posted. Run pnpm db:seed.");

  let live = await api<ScanLiveState>("/api/scan/live");
  if (!live.configured) throw new Error("The web app has no SPLAT_SLAM_URL. Set it in apps/web/.env.local and restart.");
  if (!live.reachable) throw new Error("The web app can't reach the splat-slam server. Start it with splat-slam serve.");
  console.log(`${files.length} frames at ${fps} fps to scene ${live.sceneId}, items: ${items.map((item) => item.name).join(", ") || "none"}`);

  let sent = 0;
  let kept = 0;
  let observed = 0;
  const status = () => {
    const scene = live.scene as { registered?: number; splat_version?: number; status?: string } | null;
    console.log(
      `sent ${sent}/${files.length}  kept ${kept}  registered ${scene?.registered ?? 0}  splat v${scene?.splat_version ?? 0}  pins ${observed}  ${scene?.status ?? ""}`,
    );
  };
  let polling = false;
  const timer = setInterval(() => {
    status();
    if (polling) return;
    polling = true;
    api<ScanLiveState>("/api/scan/live")
      .then((state) => (live = state))
      .catch(() => {})
      .finally(() => (polling = false));
  }, 1000);

  const started = performance.now();
  // Wall-clock based, so a second run into the same scene isn't dropped as "too soon".
  const epoch = Date.now() / 1000;
  try {
    for (const [index, file] of files.entries()) {
      const wait = started + (index * 1000) / fps - performance.now();
      if (wait > 0) await sleep(wait);
      const result = await api<ScanFrameResult>("/api/scan/live/frames", {
        method: "POST",
        headers: { "content-type": "image/jpeg", "x-session": "sim", "x-time": (epoch + index / fps).toFixed(4) },
        body: new Uint8Array(readJpeg(file)),
      });
      sent += 1;
      if (!result.kept || !result.name) continue;
      if (kept % OBSERVE_EVERY_KEPT === 0 && items.length > 0) {
        const item = items[observed % items.length]!;
        await api("/api/scan/observations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sceneId: result.sceneId,
            frame: result.name,
            observations: [{ itemId: item._id, u: 0.5, v: 0.55 }],
          }),
        });
        observed += 1;
      }
      kept += 1;
    }
  } finally {
    clearInterval(timer);
  }
  live = await api<ScanLiveState>("/api/scan/live");
  status();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
