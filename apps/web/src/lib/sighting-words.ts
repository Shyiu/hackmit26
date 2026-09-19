import type { ObservationState } from "@memory-glasses/db";

type SightingLike = {
  label: string;
  state: ObservationState;
  sentence: string | null;
  room: { name: string } | null;
};

const STATE_WORDS: Record<ObservationState, string> = {
  resting: "resting",
  held: "in a hand",
  moving: "being moved",
  in_use: "in use",
  unknown: "place unclear",
};

export function stateWords(state: ObservationState): string {
  return STATE_WORDS[state];
}

/** "keys seen on the kitchen counter", for sighting notifications and timelines. */
export function sightingPhrase(sighting: SightingLike): string {
  if (sighting.sentence) return `${sighting.label} seen ${sighting.sentence}`;
  if (sighting.state === "held" || sighting.state === "in_use") return `${sighting.label} seen in a hand`;
  if (sighting.state === "moving") return `${sighting.label} seen being moved`;
  if (sighting.room) return `${sighting.label} seen in the ${sighting.room.name}`;
  return `${sighting.label} seen, place not described yet`;
}
