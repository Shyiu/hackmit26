import type { InteractionTimings } from "@memory-glasses/shared";
import { z } from "zod";
import { idSchema, type DeviceId, type InteractionId, type ItemId, type PatientId } from "../ids";
import { answerPath, interactionStatus, playbackOutcome } from "./common";

/** Which wording the answer used. Scoring right, wrong, and abstained answers reads this. */
export const answerTemplate = z.enum([
  "fresh",
  "stale",
  "held",
  "moved",
  "unknown",
  "unseen",
  "ambiguous",
  "not_understood",
]);

export type AnswerTemplate = z.infer<typeof answerTemplate>;

const milliseconds = z.number().nonnegative();

// `satisfies` fails the build if the shared timing keys change and this doesn't.
const timingsShape = {
  stt: milliseconds.optional(),
  intent: milliseconds.optional(),
  db: milliseconds.optional(),
  llmFirstToken: milliseconds.optional(),
  ttsFirstByte: milliseconds.optional(),
  clientFirstPlayback: milliseconds.optional(),
  total: milliseconds.optional(),
} satisfies { [Stage in keyof InteractionTimings]-?: z.ZodType };

export type TimingStage = keyof typeof timingsShape;
export const TIMING_STAGES = Object.keys(timingsShape) as readonly TimingStage[];

/** One question and its answer, with per-stage timings. README "Data model". */
export const interactionDocSchema = z.strictObject({
  _id: idSchema<InteractionId>(),
  patientId: idSchema<PatientId>(),
  deviceId: idSchema<DeviceId>().nullable(),
  /** Client-generated. A retried POST finds the first interaction instead of asking twice. */
  requestId: z.string().min(1).max(100),
  askedAt: z.date(),
  expiresAt: z.date(),
  transcript: z.string().trim().min(1).max(2000),
  status: interactionStatus,
  path: answerPath.nullable(),
  itemId: idSchema<ItemId>().nullable(),
  answerTemplate: answerTemplate.nullable(),
  answerText: z.string().max(500).nullable(),
  timingsMs: z.strictObject(timingsShape),
  /** Client-reported, so kept apart from the server's own stages. */
  playbackOutcome: playbackOutcome.nullable(),
  playbackReportedAt: z.date().nullable(),
  /** The real error, for the dashboard. The wearer hears "I need a moment". */
  error: z.strictObject({ code: z.string().min(1).max(60), message: z.string().max(500) }).nullable(),
  completedAt: z.date().nullable(),
});

export type InteractionDoc = z.infer<typeof interactionDocSchema>;
