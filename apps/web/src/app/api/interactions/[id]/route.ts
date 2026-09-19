import type { InteractionId } from "@memory-glasses/db";
import { HttpError, readId, withTenant } from "@/lib/server/api";
import { interactionView } from "@/lib/server/views";

// The client polls this for the answer text, status, and final server timings.
export const GET = withTenant<{ id: string }>("any", async ({ params, tenant }) => {
  const interaction = await tenant.interactions.get(readId<InteractionId>(params.id));
  if (!interaction) throw new HttpError(404, "Not found");
  return Response.json(interactionView(interaction));
});
