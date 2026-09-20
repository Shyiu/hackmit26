import { ConflictError, duplicateKeyOf, InvalidInputError, parseDocument } from "../errors";
import { newId, type ItemId } from "../ids";
import {
  guessPlural,
  lookupCandidates,
  MAX_LOOKUP_KEY_WORDS,
  normalizeLookupKey,
  wordCount,
} from "../lookup";
import { itemDocSchema, type ItemDoc } from "../schema/items";
import { withLiveSnapshots } from "../snapshot";
import { computeUsualSpots } from "../usual-spots";
import { bumpConfigVersion, tenantCollection, type RepoContext } from "./context";

export type NewItem = {
  name: string;
  aliases?: readonly string[];
  detectorPrompts?: readonly string[];
  plural?: boolean;
};

export type ItemPatch = Partial<NewItem> & {
  /** false archives the item: its history stays and its names free up. */
  active?: boolean;
  /** The `updatedAt` the caller's form loaded. A save made since then wins, and this one gets a 409. */
  expectedUpdatedAt?: Date | null;
};

export type ItemResolution =
  | { kind: "none" }
  | { kind: "match"; item: ItemDoc; matchedKey: string }
  | { kind: "ambiguous"; items: ItemDoc[] };

const configFields = itemDocSchema.pick({
  name: true,
  plural: true,
  aliases: true,
  lookupKeys: true,
  detectorPrompts: true,
  active: true,
  updatedAt: true,
});

/** `name` plus aliases, normalized and deduplicated. Throws on names that can't be matched. */
export function lookupKeysFor(name: string, aliases: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const spoken of [name, ...aliases]) {
    const key = normalizeLookupKey(spoken);
    if (key === "") throw new InvalidInputError(`"${spoken}" has no letters or digits to match on`);
    if (wordCount(key) > MAX_LOOKUP_KEY_WORDS) {
      throw new InvalidInputError(`"${spoken}" is longer than ${MAX_LOOKUP_KEY_WORDS} words`);
    }
    keys.add(key);
  }
  return [...keys];
}

function cleanAliases(name: string, aliases: readonly string[]): string[] {
  const nameKey = normalizeLookupKey(name);
  const seen = new Set([nameKey]);
  const kept: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    const key = normalizeLookupKey(trimmed);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
  }
  return kept;
}

/** Turns a hit on the unique lookup key index into "that name already belongs to another item". */
function rethrowLookupConflict(error: unknown): never {
  const duplicate = duplicateKeyOf(error);
  if (duplicate?.index === "lookup_keys_unique") {
    const key = String(duplicate.keyValue.lookupKeys ?? "");
    throw new ConflictError(`"${key}" already names another item`, "lookupKeys", key);
  }
  throw error;
}

export function itemsRepo(ctx: RepoContext) {
  const items = tenantCollection(ctx, "items");

  /**
   * Edits names, prompts, and whether the item is archived. The write is
   * guarded on the `updatedAt` it read, so a save that lands in between gets
   * a conflict instead of losing an alias. Pass `expectedUpdatedAt` to extend
   * that guard back to when the caregiver's form loaded.
   */
  async function update(id: ItemId, patch: ItemPatch): Promise<ItemDoc | null> {
    const current = await items.findOne({ _id: id });
    if (!current) return null;
    const changedMeanwhile = () =>
      new ConflictError("Someone else changed this item; reload and try again", "updatedAt", id.toHexString());
    if (patch.expectedUpdatedAt && patch.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) {
      throw changedMeanwhile();
    }
    const name = patch.name?.trim() ?? current.name;
    const aliases = patch.aliases ? cleanAliases(name, patch.aliases) : current.aliases;
    const changes = parseDocument(configFields, {
      name,
      plural: patch.plural ?? current.plural,
      aliases,
      lookupKeys: lookupKeysFor(name, aliases),
      // The stored schema requires at least one prompt, so an explicit empty
      // list resets to the item's name instead of clearing.
      detectorPrompts:
        patch.detectorPrompts === undefined
          ? current.detectorPrompts
          : patch.detectorPrompts.length
            ? [...patch.detectorPrompts]
            : [name],
      active: patch.active ?? current.active,
      updatedAt: ctx.now(),
    });
    const updated = await items
      .findOneAndUpdate({ _id: id, updatedAt: current.updatedAt }, { $set: changes })
      .catch(rethrowLookupConflict);
    if (!updated) throw changedMeanwhile();
    await bumpConfigVersion(ctx);
    return withLiveSnapshots(updated, ctx.now());
  }

  return {
    async list({ includeArchived = false }: { includeArchived?: boolean } = {}): Promise<ItemDoc[]> {
      const now = ctx.now();
      const docs = await items.find(includeArchived ? {} : { active: true }).sort({ name: 1 }).toArray();
      return docs.map((doc) => withLiveSnapshots(doc, now));
    },

    async get(id: ItemId): Promise<ItemDoc | null> {
      const doc = await items.findOne({ _id: id });
      return doc && withLiveSnapshots(doc, ctx.now());
    },

    async create(input: NewItem): Promise<ItemDoc> {
      const now = ctx.now();
      const name = input.name.trim();
      const aliases = cleanAliases(name, input.aliases ?? []);
      const doc = parseDocument(itemDocSchema, {
        _id: newId<ItemId>(),
        patientId: ctx.patientId,
        name,
        plural: input.plural ?? guessPlural(name),
        aliases,
        lookupKeys: lookupKeysFor(name, aliases),
        detectorPrompts: input.detectorPrompts?.length ? [...input.detectorPrompts] : [name],
        referenceImageKeys: [],
        active: true,
        observationVersion: 0,
        lastSighting: null,
        lastRestingSighting: null,
        usualSpots: [],
        createdAt: now,
        updatedAt: now,
      });
      await items.insertOne(doc).catch(rethrowLookupConflict);
      await bumpConfigVersion(ctx);
      return doc;
    },

    update,

    /** Archiving keeps the history and frees the item's names for another item. */
    setActive(id: ItemId, active: boolean): Promise<ItemDoc | null> {
      return update(id, { active });
    },

    /**
     * Recomputes `usualSpots` from the item's closed, described, resting
     * sightings still inside retention. A snapshot-like write like the ones
     * perception makes: it doesn't touch `updatedAt` or bump configVersion, so
     * it can't turn a caregiver's open form into a conflict.
     */
    async recomputeUsualSpots(id: ItemId): Promise<ItemDoc | null> {
      const samples = await tenantCollection(ctx, "sightings")
        .find(
          {
            itemId: id,
            status: "closed",
            state: "resting",
            descriptionStatus: "ready",
            expiresAt: { $gt: ctx.now() },
          },
          {
            projection: {
              sentence: 1,
              surface: 1,
              relation: 1,
              room: 1,
              firstSeenAt: 1,
              lastSeenAt: 1,
              descriptionStatus: 1,
              state: 1,
            },
          },
        )
        .sort({ lastSeenAt: -1 })
        .limit(200)
        .toArray();
      const updated = await items.findOneAndUpdate({ _id: id }, { $set: { usualSpots: computeUsualSpots(samples) } });
      return updated && withLiveSnapshots(updated, ctx.now());
    },

    /**
     * The fast path. Sends every short word run in the transcript to the unique
     * lookup key index in one query and keeps the item with the longest match,
     * so "car keys" beats "keys". Ties are ambiguous and get a clarifying question.
     */
    async resolve(transcript: string): Promise<ItemResolution> {
      const candidates = lookupCandidates(transcript);
      if (candidates.length === 0) return { kind: "none" };
      // Hinted: with a handful of items the planner would rather walk every item
      // by name, which stops being cheap as the list grows.
      const matches = await items
        .find({ active: true, lookupKeys: { $in: candidates } }, { hint: "lookup_keys_unique" })
        .toArray();
      if (matches.length === 0) return { kind: "none" };

      const now = ctx.now();
      const spoken = new Set(candidates);
      const ranked = matches
        .map((item) => {
          const matchedKey = item.lookupKeys
            .filter((key) => spoken.has(key))
            .reduce((best, key) => (wordCount(key) > wordCount(best) ? key : best), "");
          return { item: withLiveSnapshots(item, now), matchedKey, words: wordCount(matchedKey) };
        })
        .sort((a, b) => b.words - a.words || b.matchedKey.length - a.matchedKey.length);

      const [best, runnerUp] = ranked;
      if (!best) return { kind: "none" };
      if (!runnerUp || best.words > runnerUp.words) {
        return { kind: "match", item: best.item, matchedKey: best.matchedKey };
      }
      return { kind: "ambiguous", items: ranked.filter((entry) => entry.words === best.words).map((entry) => entry.item) };
    },
  };
}

export type ItemsRepo = ReturnType<typeof itemsRepo>;
