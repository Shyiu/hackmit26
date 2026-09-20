import "server-only";
import {
  locationStatus,
  type AnswerTemplate,
  type ItemDoc,
  type ItemResolution,
  type PatientSettings,
} from "@memory-glasses/db";
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

export function composeAnswer(resolution: ItemResolution, settings: PatientSettings, now: Date): Answer {
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
      return describeItem(resolution.item, settings, now);
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

function describeItem(item: ItemDoc, settings: PatientSettings, now: Date): Answer {
  const snapshot = item.lastSighting;
  const them = item.plural ? "they" : "it";
  const wereAt = item.plural ? "they were" : "it was";
  const say = (template: AnswerTemplate, text: string): Answer => ({ template, text, itemId: item._id });
  // PLAN.md "the answer": an optional second sentence suggests a known usual
  // spot, only when history supports it (enough placements, often enough).
  const usual = item.usualSpots[0];
  const suggestUsual = usual && usual.share >= 0.5 && usual.samples >= 3 ? ` It's usually ${usual.sentence}.` : "";

  if (!snapshot) return say("unseen", `I haven't seen your ${item.name} in my available history.${suggestUsual}`);
  const when = relativeTime(snapshot.lastSeenAt, now);
  const status = locationStatus(snapshot);
  switch (status) {
    case "observed": {
      const stale = now.getTime() - snapshot.lastSeenAt.getTime() > settings.staleAfterMinutes * 60_000;
      // A fresh sighting answers on its own; only a stale one gets the hint.
      const text = `I last saw your ${item.name} ${snapshot.sentence}, ${when}.`;
      return say(stale ? "stale" : "fresh", stale ? text + suggestUsual : text);
    }
    case "held":
      return say("held", `I last saw your ${item.name} in your hand, ${when}.${suggestUsual}`);
    case "moved":
      // Already two sentences; the usual spot would make it three.
      return say("moved", `I saw your ${item.name} being moved. I could not tell where ${them} ended up.`);
    case "uncertain":
      return say("unknown", `I saw your ${item.name}, but I could not tell where ${wereAt}.${suggestUsual}`);
    case "unseen":
      return say("unseen", `I haven't seen your ${item.name} in my available history.${suggestUsual}`);
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
