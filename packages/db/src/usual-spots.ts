import type { ItemDoc } from "./schema/items";
import type { SightingDoc } from "./schema/sightings";

/** The sighting fields a usual-spot computation needs. */
export type UsualSpotSample = Pick<
  SightingDoc,
  "sentence" | "surface" | "relation" | "room" | "firstSeenAt" | "lastSeenAt" | "descriptionStatus" | "state"
>;

export type UsualSpotOptions = {
  /** Placements needed before any usual spot is claimed. Sparse history says nothing. */
  minSamples?: number;
  /** A place's share of all placements below this isn't a usual spot. */
  minShare?: number;
  /** Sightings at one place this close together are one placement, not several. */
  mergeGapMs?: number;
  /** Kept in step with `itemDocSchema`'s `usualSpots` cap. */
  max?: number;
};

export const USUAL_SPOT_DEFAULTS = {
  minSamples: 3,
  minShare: 0.2,
  mergeGapMs: 5 * 60_000,
  max: 5,
} as const;

export type UsualSpot = ItemDoc["usualSpots"][number];

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * What makes two sightings "the same place": the described room, surface and
 * relation, normalized, or the whole sentence when the model left them blank.
 * Null when the sighting names no place at all, so it can't vote for one.
 */
export function placeKey(sighting: UsualSpotSample): string | null {
  const room = norm(sighting.room?.name);
  const surface = norm(sighting.surface);
  const relation = norm(sighting.relation);
  if (room || surface || relation) return `${room}|${surface}|${relation}`;
  const sentence = norm(sighting.sentence);
  return sentence || null;
}

type Placement = { key: string; lastSeenAt: number; sentence: string };

/**
 * README "usual spots": where the item keeps ending up, counted in placements
 * rather than sightings so a fragmented track doesn't count twice. Only
 * finished, described, resting sightings qualify; everything else is a vote
 * for "we don't know".
 */
export function computeUsualSpots(
  sightings: readonly UsualSpotSample[],
  options: UsualSpotOptions = {},
): UsualSpot[] {
  const minSamples = options.minSamples ?? USUAL_SPOT_DEFAULTS.minSamples;
  const minShare = options.minShare ?? USUAL_SPOT_DEFAULTS.minShare;
  const mergeGapMs = options.mergeGapMs ?? USUAL_SPOT_DEFAULTS.mergeGapMs;
  const max = options.max ?? USUAL_SPOT_DEFAULTS.max;

  const usable = sightings
    .filter(
      (sighting) =>
        sighting.descriptionStatus === "ready" &&
        sighting.state === "resting" &&
        Boolean(sighting.sentence?.trim()),
    )
    .sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());

  // Merge a fragmented track at one place into a single placement.
  const placements: Placement[] = [];
  for (const sighting of usable) {
    const key = placeKey(sighting);
    if (key === null) continue;
    const prev = placements[placements.length - 1];
    if (prev && prev.key === key && sighting.firstSeenAt.getTime() - prev.lastSeenAt < mergeGapMs) {
      if (sighting.lastSeenAt.getTime() > prev.lastSeenAt) {
        prev.lastSeenAt = sighting.lastSeenAt.getTime();
        prev.sentence = sighting.sentence!;
      }
    } else {
      placements.push({ key, lastSeenAt: sighting.lastSeenAt.getTime(), sentence: sighting.sentence! });
    }
  }

  const total = placements.length;
  if (total < minSamples) return [];

  const groups = new Map<string, { samples: number; sentence: string; lastSeenAt: number }>();
  for (const placement of placements) {
    const group = groups.get(placement.key);
    if (!group) {
      groups.set(placement.key, { samples: 1, sentence: placement.sentence, lastSeenAt: placement.lastSeenAt });
    } else {
      group.samples += 1;
      if (placement.lastSeenAt >= group.lastSeenAt) {
        group.lastSeenAt = placement.lastSeenAt;
        group.sentence = placement.sentence;
      }
    }
  }

  return [...groups.values()]
    .map((group) => ({
      sentence: group.sentence,
      share: group.samples / total,
      samples: group.samples,
      source: "history" as const,
    }))
    .filter((spot) => spot.share >= minShare)
    .sort((a, b) => b.share - a.share || b.samples - a.samples || a.sentence.localeCompare(b.sentence))
    .slice(0, max);
}
