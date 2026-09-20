import "server-only";
import { type AnswerTemplate, type ItemDoc, type ItemResolution, type SightingsRepo } from "@memory-glasses/db";
import type { LastSeenPerson } from "@/lib/server/perception";
import { relativeTime } from "@/lib/relative-time";

// The fast-path wording from PLAN.md "What the wearer hears and sees": two
// sentences at most, location first, rounded time, never a correction. A
// first cut; the day-part wording ("this morning") needs the wearer's time zone.

export { relativeTime };

export type Answer = {
  template: AnswerTemplate;
  text: string;
  itemId: ItemDoc["_id"] | null;
  /** Set only on "offer_add_item", so the route can store it for the next turn's "yes". */
  pendingItemName?: string | null;
};

// Kept in sync with the client-side exemption in use-wearer-client.ts (WHO_IS_THIS_PATTERN)
// -- duplicated rather than shared, since that file is a client hook and this one is
// server-only. Asking who someone is should feel conversational, not need the call word.
const WHO_IS_THIS_PATTERN = /\bwho(?:'s| is| are)\s+(?:this|that|you)\b/i;

export function isWhoIsThisQuestion(transcript: string): boolean {
  return WHO_IS_THIS_PATTERN.test(transcript);
}

// A short yes to the "want me to add it?" offer. Deliberately narrow: a
// transcript that starts with anything else is a new question, not a reply.
const AFFIRMATIVE_PATTERN = /^\s*(yes|yeah|yep|yup|sure|okay|ok|please|correct)\b|^\s*(please\s+)?(do|add)\s+it\b/i;

export function isAffirmative(transcript: string): boolean {
  return AFFIRMATIVE_PATTERN.test(transcript);
}

export function composeWhoIsThisAnswer(person: LastSeenPerson | null, now: Date): Answer {
  if (!person) {
    return { template: "no_one_recalled", text: "I haven't recognized anyone recently.", itemId: null };
  }
  const when = relativeTime(new Date(person.seenAt), now);
  const text = person.relation
    ? `That's ${person.name}, your ${person.relation}. I saw them ${when}.`
    : `That's ${person.name}. I saw them ${when}.`;
  return { template: "person_recalled", text, itemId: null };
}

export async function composeAnswer(
  resolution: ItemResolution,
  now: Date,
  sightings: Pick<SightingsRepo, "lastDescribed">,
): Promise<Answer> {
  switch (resolution.kind) {
    case "none":
      // MVP fast-path miss. With a plausible item name to offer, ask to add it as a
      // tracked item instead of just saying it wasn't understood; the route creates
      // it if the wearer's next turn is a "yes" (see isAffirmative, composeItemAddedAnswer).
      return resolution.candidate
        ? {
            template: "offer_add_item",
            text: `I haven't been tracking your ${resolution.candidate}. Want me to add it?`,
            itemId: null,
            pendingItemName: resolution.candidate,
          }
        : { template: "not_understood", text: "Which thing should I look for?", itemId: null };
    case "ambiguous": {
      const [first, second] = resolution.items;
      return {
        template: "ambiguous",
        text: `Which one do you mean, your ${first?.name} or your ${second?.name}?`,
        itemId: null,
      };
    }
    case "match":
      return describeItem(resolution.item, now, sightings);
    default: {
      const _exhaustive: never = resolution;
      return _exhaustive;
    }
  }
}

export function composeItemAddedAnswer(item: ItemDoc): Answer {
  const them = item.plural ? "them" : "it";
  return {
    template: "item_added",
    text: `Added your ${item.name}. I'll start watching for ${them}.`,
    itemId: item._id,
  };
}

// No location data: no motion state (held/moving/resting), no usual-spot history,
// no staleness hint. Just the vision model's own sentence from the last sighting it
// actually described, whether or not that's the item's latest sighting -- a newer
// sighting still pending or failed description doesn't get spoken over an older,
// described one.
async function describeItem(item: ItemDoc, now: Date, sightings: Pick<SightingsRepo, "lastDescribed">): Promise<Answer> {
  const say = (template: AnswerTemplate, text: string): Answer => ({ template, text, itemId: item._id });
  const described = await sightings.lastDescribed(item._id);
  if (!described || !described.sentence) {
    return say("unseen", `I haven't seen your ${item.name} in my available history.`);
  }
  const when = relativeTime(described.lastSeenAt, now);
  return say("fresh", `I last saw your ${item.name} ${described.sentence}, ${when}.`);
}
