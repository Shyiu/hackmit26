import { askRequestSchema } from "@memory-glasses/shared";
import { waitUntil } from "@vercel/functions";
import {
  composeAnswer,
  composeItemAddedAnswer,
  composeWhoIsThisAnswer,
  isAffirmative,
  isWhoIsThisQuestion,
} from "@/lib/server/answer";
import { readBody, withTenant } from "@/lib/server/api";
import { getLastSeenPerson } from "@/lib/server/perception";
import { pcmHeaders, ttsProvider } from "@/lib/server/tts";
import { timedStream } from "@/lib/server/tts/timed-stream";
import { interactionView } from "@/lib/server/views";

const round = (ms: number) => Math.round(ms * 10) / 10;
// How long a "want me to add it?" offer stays open for a "yes" on the next turn.
const PENDING_OFFER_WINDOW_MS = 2 * 60_000;

// The fast path from PLAN.md "What happens when the wearer asks a question":
// one indexed query resolves the item and its latest snapshot, a template words
// the answer, no LLM runs. With a TTS provider configured the body is the audio
// stream (PCM, see pcmHeaders) and the text is polled from /api/interactions/:id.
// Without one, the interaction comes back as JSON and the phone speaks it.
export const POST = withTenant("any", async ({ request, principal, tenant, settings }) => {
  const started = performance.now();
  const body = await readBody(request, askRequestSchema);
  // Read before begin() inserts this turn's own row, so this is the previous turn.
  const [priorInteraction] = await tenant.interactions.listRecent({ limit: 1 });
  const { interaction, created } = await tenant.interactions.begin({
    requestId: body.requestId,
    transcript: body.transcript,
    deviceId: principal.kind === "device" ? principal.deviceId : null,
  });
  const headers = new Headers({ "X-Interaction-Id": interaction._id.toHexString() });

  // A retried request gets the first attempt's interaction and starts no new work.
  // 202 while that attempt is still running; the client polls for the result.
  if (!created) {
    const inFlight = interaction.status === "generating" || interaction.status === "streaming";
    return Response.json(interactionView(interaction), { status: inFlight ? 202 : 200, headers });
  }

  try {
    const lookupStarted = performance.now();
    // A "yes" right after an "offer_add_item" answer creates that item instead of
    // being resolved as its own question -- it isn't one, it's a reply to ours.
    const pendingItemName =
      priorInteraction?.answerTemplate === "offer_add_item" &&
      priorInteraction.pendingItemName &&
      Date.now() - priorInteraction.askedAt.getTime() < PENDING_OFFER_WINDOW_MS &&
      isAffirmative(body.transcript)
        ? priorInteraction.pendingItemName
        : null;
    // "Who is this" is about the most recently recognized face, not an item -- skip
    // the item-lookup index entirely rather than resolving it and discarding the result.
    const answer = pendingItemName
      ? composeItemAddedAnswer(await tenant.items.create({ name: pendingItemName }))
      : isWhoIsThisQuestion(body.transcript)
        ? composeWhoIsThisAnswer(await getLastSeenPerson(tenant), new Date())
        : composeAnswer(await tenant.items.resolve(body.transcript), settings, new Date());
    const lookupMs = performance.now() - lookupStarted;
    const outcome = {
      path: "fast" as const,
      itemId: answer.itemId,
      answerTemplate: answer.template,
      answerText: answer.text,
      pendingItemName: answer.pendingItemName ?? null,
    };
    headers.set("Server-Timing", `db;dur=${round(lookupMs)}`);

    const provider = ttsProvider();
    if (provider) {
      const ttsStarted = performance.now();
      const upstream = await provider.synthesize(answer.text, { signal: request.signal }).catch((error: unknown) => {
        // The voice is down, not the answer. Fall through to JSON so the phone speaks it.
        console.warn(`tts: ${provider.name} unavailable, answering as JSON:`, error instanceof Error ? error.message : error);
        return null;
      });
      if (upstream) {
        const streaming = await tenant.interactions.transition(interaction._id, "streaming", {
          ...outcome,
          timingsMs: { db: round(lookupMs) },
        });
        if (streaming) {
          // Stage timings land with the final transition, once the stream has ended one way or another.
          let ttsFirstByte: number | undefined;
          const audio = timedStream(
            upstream,
            {
              onFirstByte: (ms) => {
                ttsFirstByte = round(ms);
              },
              onEnd: (result, error) => {
                const ttsTimings = ttsFirstByte === undefined ? {} : { ttsFirstByte };
                const final =
                  result === "complete"
                    ? tenant.interactions.transition(interaction._id, "complete", {
                        timingsMs: { ...ttsTimings, total: round(performance.now() - started) },
                      })
                    : tenant.interactions.transition(interaction._id, result, {
                        timingsMs: ttsTimings,
                        ...(result === "failed" && {
                          error: { code: "tts_failed", message: String(error instanceof Error ? error.message : error).slice(0, 500) },
                        }),
                      });
                waitUntil(final.catch(() => null));
              },
            },
            ttsStarted,
          );
          for (const [name, value] of Object.entries(pcmHeaders(provider.format))) headers.set(name, value);
          return new Response(audio, { headers });
        }
        await upstream.cancel().catch(() => null);
      }
    }

    const completed = await tenant.interactions.transition(interaction._id, "complete", {
      ...outcome,
      timingsMs: { db: round(lookupMs), total: round(performance.now() - started) },
    });
    const current = completed ?? (await tenant.interactions.get(interaction._id)) ?? interaction;
    return Response.json(interactionView(current), { headers });
  } catch (error) {
    // Never leave it "generating": the dashboard shows the real error, and a
    // retry with the same requestId gets a final status instead of waiting forever.
    const message = error instanceof Error ? error.message : String(error);
    await tenant.interactions
      .transition(interaction._id, "failed", { error: { code: "answer_failed", message: message.slice(0, 500) } })
      .catch(() => null);
    throw error;
  }
});
