import type { CaptureSource } from "@memory-glasses/db";

export function createPairingKind(kind: "wear" | "sim"): CaptureSource {
  return kind === "wear" ? "headset" : "simulator";
}

export function pairingKindLabel(kind: CaptureSource): string {
  return kind === "headset" ? "Chest phone" : kind === "simulator" ? "Simulator" : "Glasses";
}
