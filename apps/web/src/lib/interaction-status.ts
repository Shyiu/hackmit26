import type { InteractionStatus } from "@memory-glasses/db";

export const INTERACTION_LABELS: Record<InteractionStatus, string> = {
  generating: "Answering",
  streaming: "Speaking",
  complete: "Answered",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const INTERACTION_VARIANTS: Record<InteractionStatus, "default" | "secondary" | "outline" | "destructive"> = {
  generating: "secondary",
  streaming: "secondary",
  complete: "outline",
  failed: "destructive",
  cancelled: "outline",
};
