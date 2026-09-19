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

/** "keys" and "glasses" take "they were", "wallet" takes "it was". The caregiver can override. */
export function guessPlural(name: string): boolean {
  const lastWord = normalizeLookupKey(name).split(" ").at(-1) ?? "";
  return lastWord.endsWith("s") && !lastWord.endsWith("ss");
}
