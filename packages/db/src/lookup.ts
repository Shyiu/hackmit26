/** Longest spoken name we match, in words. "the blue car keys" is four. */
export const MAX_LOOKUP_KEY_WORDS = 4;
export const MAX_ALIASES = 20;

/**
 * The one normalization for spoken item names, applied to lookup keys when an
 * item is saved and to transcripts when a question comes in. Lowercases, strips
 * accents and apostrophes, and turns every other non-alphanumeric run into one
 * space: "Grandma's Car-Keys!" becomes "grandmas car keys".
 */
export function normalizeLookupKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function wordCount(normalized: string): number {
  return normalized === "" ? 0 : normalized.split(" ").length;
}

/**
 * Every run of one to MAX_LOOKUP_KEY_WORDS consecutive words in the transcript.
 * The fast path sends these to the unique lookup key index as one `$in` query,
 * so resolving "where are my car keys" needs no alias cache.
 */
export function lookupCandidates(transcript: string): string[] {
  const words = normalizeLookupKey(transcript).split(" ").filter(Boolean);
  const candidates = new Set<string>();
  for (let start = 0; start < words.length; start++) {
    for (let size = 1; size <= MAX_LOOKUP_KEY_WORDS && start + size <= words.length; size++) {
      candidates.add(words.slice(start, start + size).join(" "));
    }
  }
  return [...candidates];
}

// Question words the fast path strips off the front of a transcript before guessing
// what's left is the item's name, so "where are my flashlight" offers "flashlight"
// rather than the whole question. Not exhaustive grammar, just an MVP heuristic.
const LEADING_STOPWORDS = new Set([
  "where",
  "whats",
  "is",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "can",
  "could",
  "you",
  "i",
  "ive",
  "anyone",
  "seen",
  "know",
  "find",
  "lost",
  "put",
  "my",
  "the",
  "a",
  "an",
]);

/**
 * A best guess at the item name in a transcript the fast path couldn't
 * resolve, by stripping leading question words. Used to offer adding it as a
 * new tracked item rather than just saying "not understood". Returns null for
 * a transcript that's all stopwords (or empty), so there's nothing to offer.
 */
export function guessItemName(transcript: string): string | null {
  const words = normalizeLookupKey(transcript).split(" ").filter(Boolean);
  let start = 0;
  while (start < words.length && LEADING_STOPWORDS.has(words[start])) start++;
  const rest = words.slice(start, start + MAX_LOOKUP_KEY_WORDS);
  return rest.length > 0 ? rest.join(" ") : null;
}

/** "keys" and "glasses" take "they were", "wallet" takes "it was". The caregiver can override. */
export function guessPlural(name: string): boolean {
  const lastWord = normalizeLookupKey(name).split(" ").at(-1) ?? "";
  return lastWord.endsWith("s") && !lastWord.endsWith("ss");
}
