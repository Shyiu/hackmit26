import type { InteractionId } from "@memory-glasses/db";
import { playbackReportSchema } from "@memory-glasses/shared";
import { HttpError, readBody, readId, withTenant } from "@/lib/server/api";
import { interactionView } from "@/lib/server/views";

// Client-reported playback, stored apart from the server's own timings. The
// first report wins, so a retry is harmless.
export const POST = withTenant<{ id: string }>("any", async ({ request, params, tenant }) => {
  const report = await readBody(request, playbackReportSchema);
  const interaction = await tenant.interactions.recordPlayback(readId<InteractionId>(params.id), report);
  if (!interaction) throw new HttpError(404, "Not found");
  return Response.json(interactionView(interaction));
});
