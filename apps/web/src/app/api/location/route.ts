import { reportLocationSchema } from "@memory-glasses/shared";
import { readBody, withTenant } from "@/lib/server/api";
import { recordLocation } from "@/lib/server/lost";

export const POST = withTenant("any", async ({ request, settings, tenant }) => {
  const report = await readBody(request, reportLocationSchema);
  return Response.json(await recordLocation(tenant, settings, report));
});
