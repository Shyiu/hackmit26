import "server-only";
import {
  locationStatus,
  type AnswerTemplate,
  type ItemDoc,
  type ItemResolution,
  type PatientSettings,
} from "@memory-glasses/db";

// The fast-path wording from README "What the wearer hears and sees": two
// sentences at most, location first, rounded time, never a correction. A
// first cut; the day-part wording ("this morning") needs the wearer's time zone.

export type Answer = { template: AnswerTemplate; text: string; itemId: ItemDoc["_id"] | null };

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function spokenMinutes(minutes: number): string {
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  const words: Record<number, string> = {
    5: "five",
    10: "ten",
    15: "fifteen",
    20: "twenty",
    25: "twenty-five",
    30: "thirty",
    35: "thirty-five",
    40: "forty",
  };
  return words[rounded] ?? String(rounded);
}

/** "a few minutes ago", "about twenty minutes ago". Nobody wants to hear "47 minutes ago". */
export function relativeTime(then: Date, now: Date): string {
  const minutes = (now.getTime() - then.getTime()) / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 5) return "a few minutes ago";
  if (minutes < 43) return `about ${spokenMinutes(minutes)} minutes ago`;
  if (minutes < 90) return "about an hour ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `about ${NUMBER_WORDS[hours] ?? hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  return days <= 7 ? `about ${NUMBER_WORDS[days] ?? days} days ago` : "more than a week ago";
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
