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

// The fast-path wording from README "What the wearer hears and sees": two
// sentences at most, location first, rounded time, never a correction. A
// first cut; the day-part wording ("this morning") needs the wearer's time zone.

export { relativeTime };

export type Answer = { template: AnswerTemplate; text: string; itemId: ItemDoc["_id"] | null };

// Kept in sync with the client-side exemption in use-wearer-client.ts (WHO_IS_THIS_PATTERN)
// -- duplicated rather than shared, since that file is a client hook and this one is
// server-only. Asking who someone is should feel conversational, not need the call word.
const WHO_IS_THIS_PATTERN = /\bwho(?:'s| is| are)\s+(?:this|that|you)\b/i;

export function isWhoIsThisQuestion(transcript: string): boolean {
  return WHO_IS_THIS_PATTERN.test(transcript);
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
      // MVP fast-path miss: ask which tracked item they mean.
      return { template: "not_understood", text: "Which thing should I look for?", itemId: null };
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

function describeItem(item: ItemDoc, settings: PatientSettings, now: Date): Answer {
  const snapshot = item.lastSighting;
  const them = item.plural ? "they" : "it";
  const wereAt = item.plural ? "they were" : "it was";
  const say = (template: AnswerTemplate, text: string): Answer => ({ template, text, itemId: item._id });

  if (!snapshot) return say("unseen", `I haven't seen your ${item.name} in my available history.`);
  const when = relativeTime(snapshot.lastSeenAt, now);
  const status = locationStatus(snapshot);
  switch (status) {
    case "observed": {
      const stale = now.getTime() - snapshot.lastSeenAt.getTime() > settings.staleAfterMinutes * 60_000;
      return say(stale ? "stale" : "fresh", `I last saw your ${item.name} ${snapshot.sentence}, ${when}.`);
    }
    case "held":
      return say("held", `I last saw your ${item.name} in your hand, ${when}.`);
    case "moved":
      return say("moved", `I saw your ${item.name} being moved. I could not tell where ${them} ended up.`);
    case "uncertain":
      return say("unknown", `I saw your ${item.name}, but I could not tell where ${wereAt}.`);
    case "unseen":
      return say("unseen", `I haven't seen your ${item.name} in my available history.`);
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
