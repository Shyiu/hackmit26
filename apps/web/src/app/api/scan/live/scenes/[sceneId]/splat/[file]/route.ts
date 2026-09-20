import { HttpError, withTenant } from "@/lib/server/api";
import { assertSceneOwned, slamFetch } from "@/lib/server/scan";

// One published splat version. A version's bytes never change, so the browser keeps it.
export const GET = withTenant<{ sceneId: string; file: string }>("any", async ({ params, tenant }) => {
  if (!/^v\d{4}\.(spz|ply)$/.test(params.file)) throw new HttpError(404, "Not found");
  await assertSceneOwned(tenant.patientId, params.sceneId);
  const response = await slamFetch(`/scenes/${params.sceneId}/splat/${params.file}`, { timeoutMs: 60_000, stream: true });
  // Only the last two versions are kept upstream.
  if (response.status === 404) throw new HttpError(404, "Not found");
  if (!response.ok || !response.body) throw new HttpError(502, `The splat-slam server answered ${response.status}`);
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "cache-control": "private, max-age=31536000, immutable",
  });
  const length = response.headers.get("content-length");
  if (length && !response.headers.get("content-encoding")) headers.set("content-length", length);
  return new Response(response.body, { headers });
});
