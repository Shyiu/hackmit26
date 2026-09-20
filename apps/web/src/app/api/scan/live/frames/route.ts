import type { ScanFrameResult } from "@memory-glasses/shared";
import { HttpError, withTenant } from "@/lib/server/api";
import { currentSceneId, forgetCurrentScene, readJson, slamFetch } from "@/lib/server/scan";

// splat-slam takes 20 MB; a phone JPEG is well under one.
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

type Upstream = { kept: boolean; reason: string; name?: string };

// Route handlers have no body limit of their own, so the cap is applied while reading:
// an oversized upload is dropped at 8 MB instead of being held whole in memory.
async function readFrame(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const tooBig = () => new HttpError(413, "That frame is over 8 MB");
  if (Number(request.headers.get("content-length")) > MAX_FRAME_BYTES) throw tooBig();
  if (!request.body) throw new HttpError(400, "The body must be one JPEG");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FRAME_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  if (total === 0) throw new HttpError(400, "The body must be one JPEG");
  // One buffer, because the 404 retry below sends it twice.
  const jpeg = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    jpeg.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return jpeg;
}

// One camera frame for the live scan. `name` is the string cameras.json will list this
// frame under once it is posed, which is what ties an observation to a camera.
export const POST = withTenant("any", async ({ request, tenant }) => {
  const jpeg = await readFrame(request);

  const headers: Record<string, string> = {
    "content-type": "image/jpeg",
    "x-session": (request.headers.get("x-session") ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "s0",
  };
  const time = Number(request.headers.get("x-time"));
  if (request.headers.get("x-time") && Number.isFinite(time)) headers["x-time"] = String(time);

  const send = async () => {
    const sceneId = await currentSceneId(tenant.patientId);
    return { sceneId, response: await slamFetch(`/api/scenes/${sceneId}/frames`, { method: "POST", headers, body: jpeg }) };
  };
  let { sceneId, response } = await send();
  if (response.status === 404) {
    // The cached scene is gone (the server was wiped): look again, once.
    forgetCurrentScene(tenant.patientId);
    ({ sceneId, response } = await send());
  }
  if (response.status === 400 || response.status === 413) {
    throw new HttpError(response.status, await response.text().catch(() => "The splat-slam server refused that frame"));
  }
  if (!response.ok) throw new HttpError(502, `The splat-slam server answered ${response.status}`);

  const result = await readJson<Upstream>(response);
  return Response.json({
    sceneId,
    kept: result.kept,
    reason: result.reason,
    name: result.name ?? null,
  } satisfies ScanFrameResult);
});
