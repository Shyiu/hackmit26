import type { Document, MatchKeysAndValues } from "mongodb";
import { z } from "zod";
import { ConflictError, duplicateKeyOf, parseDocument } from "../errors";
import { newId, type DeviceId, type InteractionId } from "../ids";
import { interactionStatus, playbackOutcome, type InteractionStatus } from "../schema/common";
import {
  interactionDocSchema,
  TIMING_STAGES,
  type InteractionDoc,
  type TimingStage,
} from "../schema/interactions";
import { expiresAt, tenantCollection, type RepoContext } from "./context";

/**
 * Allowed status moves. A cancelled or failed interaction can't be revived by
 * a late write, and "complete" is final. Terminal statuses have no exits.
 */
const TRANSITIONS: Readonly<Record<InteractionStatus, readonly InteractionStatus[]>> = {
  generating: ["streaming", "complete", "failed", "cancelled"],
  streaming: ["complete", "failed", "cancelled"],
  complete: [],
  failed: [],
  cancelled: [],
};

function sourcesOf(to: InteractionStatus): InteractionStatus[] {
  return interactionStatus.options.filter((from) => TRANSITIONS[from].includes(to));
}

const playbackReportInput = z.strictObject({
  outcome: playbackOutcome,
  /** A minute is already a broken answer; larger values are client bugs. */
  clientFirstPlaybackMs: z.number().nonnegative().max(60_000).optional(),
});

export type PlaybackReport = z.input<typeof playbackReportInput>;

export type BeginInteraction = {
  requestId: string;
  transcript: string;
  deviceId?: DeviceId | null;
  askedAt?: Date;
};

export type InteractionOutcome = Partial<
  Pick<InteractionDoc, "path" | "itemId" | "answerTemplate" | "answerText" | "pendingItemName" | "error">
> & { timingsMs?: Partial<Record<TimingStage, number>> };

export type StageStats = { samples: number; p50: number | null; p95: number | null };
export type LatencyStats = { interactions: number; stages: Record<TimingStage, StageStats> };

export function interactionsRepo(ctx: RepoContext) {
  const interactions = tenantCollection(ctx, "interactions");

  return {
    /**
     * Starts an interaction, or finds the one this requestId already started.
     * `created: false` means a retry: return the existing id and don't call the
     * voice provider again.
     */
    async begin(input: BeginInteraction): Promise<{ interaction: InteractionDoc; created: boolean }> {
      const now = ctx.now();
      const askedAt = input.askedAt ?? now;
      const fields = {
        _id: newId<InteractionId>(),
        deviceId: input.deviceId ?? null,
        askedAt,
        expiresAt: expiresAt(ctx, askedAt),
        // Stored as parsed, so the trimmed text is what lands.
        transcript: parseDocument(interactionDocSchema.shape.transcript, input.transcript),
        status: "generating" as const,
        path: null,
        itemId: null,
        answerTemplate: null,
        answerText: null,
        pendingItemName: null,
        timingsMs: {},
        playbackOutcome: null,
        playbackReportedAt: null,
        error: null,
        completedAt: null,
      };
      parseDocument(interactionDocSchema, { ...fields, patientId: ctx.patientId, requestId: input.requestId });
      let result: { doc: InteractionDoc; created: boolean };
      try {
        // patientId and requestId come from the filter, the rest only on insert.
        result = await interactions.upsertOne({ requestId: input.requestId }, { $setOnInsert: fields });
      } catch (error) {
        // Two copies of one request raced and the loser hit request_unique. The winner's row exists.
        if (duplicateKeyOf(error)?.index !== "request_unique") throw error;
        const existing = await interactions.findOne({ requestId: input.requestId });
        if (!existing) throw error;
        result = { doc: existing, created: false };
      }
      // A requestId from a record past retention would otherwise hand back its transcript.
      if (!result.created && result.doc.expiresAt <= now) {
        throw new ConflictError("That requestId was used before; send a new one", "requestId", input.requestId);
      }
      return { interaction: result.doc, created: result.created };
    },

    /**
     * Moves the status forward and records the outcome. Returns null when the
     * move isn't allowed from the current status, so a late "complete" can't
     * overwrite a cancellation.
     */
    async transition(id: InteractionId, to: InteractionStatus, outcome: InteractionOutcome = {}) {
      const { timingsMs, ...fields } = outcome;
      const $set: MatchKeysAndValues<InteractionDoc> = {
        ...fields,
        status: to,
        ...(TRANSITIONS[to].length === 0 && { completedAt: ctx.now() }),
      };
      // Dotted paths set single stages, so a later write can't wipe an earlier one.
      for (const [stage, ms] of Object.entries(timingsMs ?? {})) $set[`timingsMs.${stage}`] = ms;
      return interactions.findOneAndUpdate({ _id: id, status: { $in: sourcesOf(to) } }, { $set });
    },

    /** Client playback telemetry. The first report wins; a retried report changes nothing. */
    async recordPlayback(id: InteractionId, input: PlaybackReport) {
      const report = parseDocument(playbackReportInput, input);
      const now = ctx.now();
      const $set: MatchKeysAndValues<InteractionDoc> = {
        playbackOutcome: report.outcome,
        playbackReportedAt: now,
      };
      if (report.clientFirstPlaybackMs !== undefined) {
        $set["timingsMs.clientFirstPlayback"] = report.clientFirstPlaybackMs;
      }
      const live = { _id: id, expiresAt: { $gt: now } };
      const updated = await interactions.findOneAndUpdate({ ...live, playbackReportedAt: null }, { $set });
      return updated ?? interactions.findOne(live);
    },

    get(id: InteractionId) {
      return interactions.findOne({ _id: id, expiresAt: { $gt: ctx.now() } });
    },

    /** Newest first. Pass the last `askedAt` you got as `before` for the next page. */
    listRecent({ limit = 50, before }: { limit?: number; before?: Date } = {}) {
      const now = ctx.now();
      return interactions
        .find({ askedAt: { $lt: before ?? now }, expiresAt: { $gt: now } })
        .sort({ askedAt: -1 })
        .limit(Math.min(limit, 200))
        .toArray();
    },

    /**
     * P50 and P95 per stage over completed interactions, computed by MongoDB's
     * $percentile. Stage percentiles don't add up to an end-to-end percentile,
     * which is why `total` is its own stage.
     */
    async latencyStats({ since }: { since: Date }): Promise<LatencyStats> {
      const group: Document = { _id: null, interactions: { $sum: 1 } };
      for (const stage of TIMING_STAGES) {
        const field = `$timingsMs.${stage}`;
        group[`${stage}Percentiles`] = { $percentile: { input: field, p: [0.5, 0.95], method: "approximate" } };
        group[`${stage}Samples`] = { $sum: { $cond: [{ $isNumber: field }, 1, 0] } };
      }
      const [row] = await interactions
        .aggregate<Document>([
          { $match: { askedAt: { $gte: since }, status: "complete", expiresAt: { $gt: ctx.now() } } },
          { $group: group },
        ])
        .toArray();

      const stages = Object.fromEntries(
        TIMING_STAGES.map((stage) => {
          const percentiles: unknown = row?.[`${stage}Percentiles`];
          const [p50, p95] = Array.isArray(percentiles) ? percentiles : [];
          return [
            stage,
            {
              samples: Number(row?.[`${stage}Samples`] ?? 0),
              p50: typeof p50 === "number" ? p50 : null,
              p95: typeof p95 === "number" ? p95 : null,
            },
          ];
        }),
      ) as Record<TimingStage, StageStats>;
      return { interactions: Number(row?.interactions ?? 0), stages };
    },
  };
}

export type InteractionsRepo = ReturnType<typeof interactionsRepo>;
