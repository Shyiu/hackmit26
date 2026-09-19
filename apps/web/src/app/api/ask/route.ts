import { askRequestSchema } from "@memory-glasses/shared";
import { composeAnswer } from "@/lib/server/answer";
import { readBody, withTenant } from "@/lib/server/api";
import { interactionView } from "@/lib/server/views";

const round = (ms: number) => Math.round(ms * 10) / 10;

// The fast path from README "What happens when the wearer asks a question":
// one indexed query resolves the item and its latest snapshot, a template words
// the answer, no LLM runs. Until TTS lands in M2 the answer comes back as JSON;
// the audio stream will replace the body and keep the X-Interaction-Id header.
export const POST = withTenant("any", async ({ request, principal, tenant, settings }) => {
  const started = performance.now();
  const body = await readBody(request, askRequestSchema);
  const { interaction, created } = await tenant.interactions.begin({
    requestId: body.requestId,
    transcript: body.transcript,
    deviceId: principal.kind === "device" ? principal.deviceId : null,
  });
  const headers = new Headers({ "X-Interaction-Id": interaction._id.toHexString() });

  // A retried request gets the first attempt's interaction and starts no new work.
  if (!created) return Response.json(interactionView(interaction), { headers });

  const lookupStarted = performance.now();
  const resolution = await tenant.items.resolve(body.transcript);
  const lookupMs = performance.now() - lookupStarted;
  const answer = composeAnswer(resolution, settings, new Date());

  const completed = await tenant.interactions.transition(interaction._id, "complete", {
    path: "fast",
    itemId: answer.itemId,
    answerTemplate: answer.template,
    answerText: answer.text,
    timingsMs: { db: round(lookupMs), total: round(performance.now() - started) },
  });
  headers.set("Server-Timing", `db;dur=${round(lookupMs)}`);
  return Response.json(interactionView(completed ?? interaction), { headers });
});
