import type { LocationStatus } from "@memory-glasses/db";

// The caregiver-facing name for what the latest evidence supports saying.
export const STATUS_LABELS: Record<LocationStatus, string> = {
  observed: "Seen resting",
  held: "In hand",
  moved: "Being moved",
  uncertain: "Place unclear",
  unseen: "Not seen yet",
};

// Where the evidence is weak, the badge reads as a muted outline instead of solid.
export const STATUS_VARIANTS: Record<LocationStatus, "default" | "secondary" | "outline"> = {
  observed: "default",
  held: "secondary",
  moved: "secondary",
  uncertain: "outline",
  unseen: "outline",
};

type SnapshotLike = { sentence: string | null; state: string } | null;

/** The card's location line. Falls back to the motion state when there's no sentence. */
export function whereLine(snapshot: SnapshotLike): string {
  if (!snapshot) return "Not seen yet";
  if (snapshot.sentence) return snapshot.sentence;
  if (snapshot.state === "held" || snapshot.state === "in_use") return "In someone's hand";
  if (snapshot.state === "moving") return "Being carried somewhere";
  return "Place not described yet";
}
