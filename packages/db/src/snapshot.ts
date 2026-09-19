import type { ItemDoc, SightingSnapshot } from "./schema/items";

export type LocationStatus = "unseen" | "observed" | "held" | "moved" | "uncertain";

type WithSnapshots = Pick<ItemDoc, "lastSighting" | "lastRestingSighting">;

/**
 * Nulls out snapshots whose sighting has expired. TTL deletion runs late and
 * the retention sweep runs on a schedule, so every item read goes through this
 * and nothing past retention reaches an answer.
 */
export function withLiveSnapshots<TItem extends WithSnapshots>(item: TItem, now: Date): TItem {
  const live = (snapshot: SightingSnapshot | null) =>
    snapshot && snapshot.expiresAt > now ? snapshot : null;
  const lastSighting = live(item.lastSighting);
  const lastRestingSighting = live(item.lastRestingSighting);
  if (lastSighting === item.lastSighting && lastRestingSighting === item.lastRestingSighting) {
    return item;
  }
  return { ...item, lastSighting, lastRestingSighting };
}

/**
 * What the latest evidence supports saying, per README "What the wearer hears
 * and sees". Derived on read instead of stored, so perception can't write a
 * status that disagrees with the snapshot next to it.
 */
export function locationStatus(snapshot: SightingSnapshot | null): LocationStatus {
  if (!snapshot) return "unseen";
  switch (snapshot.state) {
    case "held":
    case "in_use":
      return "held";
    case "moving":
      return "moved";
    case "resting":
      return snapshot.descriptionStatus === "ready" && snapshot.sentence ? "observed" : "uncertain";
    case "unknown":
      return "uncertain";
    default: {
      const _exhaustive: never = snapshot.state;
      return _exhaustive;
    }
  }
}
