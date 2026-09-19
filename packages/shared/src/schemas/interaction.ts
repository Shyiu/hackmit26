import { z } from "zod";

export const askRequestSchema = z.object({
  transcript: z.string().min(1),
  requestId: z.string().min(1),
});

export const interactionTimingsSchema = z.object({
  stt: z.number().optional(),
  intent: z.number().optional(),
  db: z.number().optional(),
  llmFirstToken: z.number().optional(),
  ttsFirstByte: z.number().optional(),
  clientFirstPlayback: z.number().optional(),
  total: z.number().optional(),
});

export const interactionStatusSchema = z.enum([
  "generating",
  "streaming",
  "complete",
  "failed",
  "cancelled",
]);

export const playbackReportSchema = z.object({
  clientFirstPlaybackMs: z.number().optional(),
  outcome: z.enum(["played", "partial", "failed", "cancelled"]),
});

export const interactionSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  requestId: z.string(),
  askedAt: z.coerce.date(),
  transcript: z.string(),
  expiresAt: z.coerce.date(),
  status: interactionStatusSchema,
  path: z.enum(["fast", "llm"]).optional(),
  itemId: z.string().optional(),
  answerText: z.string().optional(),
  timingsMs: interactionTimingsSchema,
  playbackReportedAt: z.coerce.date().optional(),
});

export type AskRequest = z.infer<typeof askRequestSchema>;
export type InteractionTimings = z.infer<typeof interactionTimingsSchema>;
export type InteractionStatus = z.infer<typeof interactionStatusSchema>;
export type PlaybackReport = z.infer<typeof playbackReportSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
