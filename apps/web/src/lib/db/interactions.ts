import { MongoServerError, ObjectId } from "mongodb";
import type {
  Interaction,
  InteractionStatus,
  InteractionTimings,
  PlaybackReport,
} from "@memory-glasses/shared";
import { interactions, unexpired } from "./collections";
import { toInteraction, toObjectId } from "./serialize";

const DUPLICATE_KEY = 11000;

export function retentionDays(): number {
  return Number(process.env.RETENTION_DAYS ?? 30);
}

function expiryFrom(askedAt: Date): Date {
  return new Date(askedAt.getTime() + retentionDays() * 24 * 60 * 60 * 1000);
}

// Duplicate questions return the existing interaction instead of starting a
// second provider request. The unique (patientId, requestId) index is what makes
// this safe under a retry storm.
export async function claimInteraction(
  patientId: string,
  requestId: string,
  transcript: string
): Promise<{ interaction: Interaction; created: boolean }> {
  const collection = await interactions();
  const askedAt = new Date();

  let created = false;
  try {
    const result = await collection.updateOne(
      { patientId, requestId },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          patientId,
          requestId,
          transcript,
          askedAt,
          expiresAt: expiryFrom(askedAt),
          status: "generating" as InteractionStatus,
          timingsMs: {},
        },
      },
      { upsert: true }
    );
    created = result.upsertedCount === 1;
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== DUPLICATE_KEY) {
      throw error;
    }
  }

  const doc = await collection.findOne({ patientId, requestId });
  if (!doc) {
    throw new Error("interaction disappeared after upsert");
  }
  return { interaction: toInteraction(doc), created };
}

export async function getInteraction(
  patientId: string,
  id: string
): Promise<Interaction | null> {
  const _id = toObjectId(id);
  if (!_id) {
    return null;
  }
  const doc = await (await interactions()).findOne({ _id, patientId, ...unexpired() });
  return doc ? toInteraction(doc) : null;
}

export async function listInteractions(
  patientId: string,
  limit = 50
): Promise<Interaction[]> {
  const docs = await (await interactions())
    .find({ patientId, ...unexpired() })
    .sort({ askedAt: -1 })
    .limit(Math.min(limit, 200))
    .toArray();
  return docs.map(toInteraction);
}

export type InteractionUpdate = {
  status?: InteractionStatus;
  path?: Interaction["path"];
  itemId?: string;
  answerText?: string;
  timings?: InteractionTimings;
};

export async function updateInteraction(
  patientId: string,
  id: string,
  update: InteractionUpdate
): Promise<void> {
  const _id = toObjectId(id);
  if (!_id) {
    return;
  }

  const { timings, itemId, ...rest } = update;
  const set: Record<string, unknown> = { ...rest };
  if (itemId) {
    set.itemId = toObjectId(itemId) ?? undefined;
  }
  for (const [stage, value] of Object.entries(timings ?? {})) {
    if (value !== undefined) {
      set[`timingsMs.${stage}`] = value;
    }
  }

  if (Object.keys(set).length > 0) {
    await (await interactions()).updateOne({ _id, patientId }, { $set: set });
  }
}

// Client-reported telemetry. A failed or partial playback is not a success, so
// it overrides the server's optimistic "complete".
export async function recordPlayback(
  patientId: string,
  id: string,
  report: PlaybackReport
): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) {
    return false;
  }

  const status: InteractionStatus =
    report.outcome === "played"
      ? "complete"
      : report.outcome === "cancelled"
        ? "cancelled"
        : "failed";

  const result = await (await interactions()).updateOne(
    { _id, patientId },
    {
      $set: {
        status,
        playbackReportedAt: new Date(),
        ...(report.clientFirstPlaybackMs === undefined
          ? {}
          : { "timingsMs.clientFirstPlayback": report.clientFirstPlaybackMs }),
      },
    }
  );
  return result.matchedCount === 1;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[Math.max(index, 0)];
}

export type StageStats = {
  stage: keyof InteractionTimings;
  samples: number;
  p50: number | null;
  p95: number | null;
};

// Stage percentiles do not add up to an end-to-end percentile; the dashboard
// reports them per stage with their sample count, as the README asks.
export async function latencyStats(
  patientId: string,
  limit = 200
): Promise<StageStats[]> {
  const recent = await listInteractions(patientId, limit);
  const stages: (keyof InteractionTimings)[] = [
    "stt",
    "intent",
    "db",
    "llmFirstToken",
    "ttsFirstByte",
    "clientFirstPlayback",
    "total",
  ];

  return stages.map((stage) => {
    const values = recent
      .map((interaction) => interaction.timingsMs[stage])
      .filter((value): value is number => typeof value === "number");
    return {
      stage,
      samples: values.length,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
    };
  });
}
