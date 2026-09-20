import { HttpError, withTenant } from "@/lib/server/api";
import { assertSceneOwned, slamFetch } from "@/lib/server/scan";

// The scene's camera poses and orbit frame. 404 until splat-slam has its first map.
export const GET = withTenant<{ sceneId: string }>("any", async ({ params, tenant }) => {
  await assertSceneOwned(tenant.patientId, params.sceneId);
  const response = await slamFetch(`/scenes/${params.sceneId}/cameras.json`, { stream: true });
  if (response.status === 404) throw new HttpError(404, "No map yet");
  if (!response.ok) throw new HttpError(502, `The splat-slam server answered ${response.status}`);
  return new Response(response.body, {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});
