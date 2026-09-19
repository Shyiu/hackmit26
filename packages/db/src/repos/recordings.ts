import { parseDocument } from "../errors";
import { newId, type DeviceId, type RecordingId } from "../ids";
import { recordingChunkSchema, recordingDocSchema, type RecordingChunk, type RecordingDoc } from "../schema/recordings";
import { expiresAt, tenantCollection, type RepoContext } from "./context";

export type NewRecording = {
  sessionId: string;
  startedAt: Date;
  mimeType: string;
  width: number;
  height: number;
  hasAudio: boolean;
  deviceId?: DeviceId | null;
};

export type NewRecordingChunk = Omit<RecordingChunk, "key">;

export type AddChunkResult =
  | { kind: "added" | "existing"; recording: RecordingDoc; chunk: RecordingChunk }
  | { kind: "missing" };

/** The bucket key for one chunk: one prefix per wearer and recording, one object per chunk. */
export function recordingChunkKey(recording: Pick<RecordingDoc, "patientId" | "_id">, seq: number) {
  return `recordings/${recording.patientId.toHexString()}/${recording._id.toHexString()}/${String(seq).padStart(5, "0")}`;
}

/** Recordings that left the phone, one document per phone recording session. Optional after M3. */
export function recordingsRepo(ctx: RepoContext) {
  const recordings = tenantCollection(ctx, "recordings");

  return {
    /** Registers a recording. A retry with the same `sessionId` finds the first one. */
    async create(input: NewRecording): Promise<{ recording: RecordingDoc; created: boolean }> {
      const existing = await recordings.findOne({ sessionId: input.sessionId });
      if (existing) return { recording: existing, created: false };
      const doc = parseDocument(recordingDocSchema, {
        _id: newId<RecordingId>(),
        patientId: ctx.patientId,
        deviceId: input.deviceId ?? null,
        sessionId: input.sessionId,
        startedAt: input.startedAt,
        endedAt: null,
        expiresAt: expiresAt(ctx, input.startedAt),
        mimeType: input.mimeType,
        width: input.width,
        height: input.height,
        hasAudio: input.hasAudio,
        chunks: [],
      });
      await recordings.insertOne(doc);
      return { recording: doc, created: true };
    },

    get(id: RecordingId): Promise<RecordingDoc | null> {
      return recordings.findOne({ _id: id });
    },

    /**
     * Records one chunk and hands back its key. The same `seq` twice, as when
     * the phone retries after losing the network, returns the first key rather
     * than a second object, so an upload resumes where it stopped.
     */
    async addChunk(id: RecordingId, input: NewRecordingChunk, { final = false } = {}): Promise<AddChunkResult> {
      const recording = await recordings.findOne({ _id: id });
      if (!recording) return { kind: "missing" };
      const existing = recording.chunks.find((chunk) => chunk.seq === input.seq);
      if (existing) return { kind: "existing", recording, chunk: existing };
      const chunk = parseDocument(recordingChunkSchema, { ...input, key: recordingChunkKey(recording, input.seq) });
      const endedAt = final ? new Date(input.startedAt.getTime() + input.durationMs) : recording.endedAt;
      const updated = await recordings.findOneAndUpdate(
        { _id: id, "chunks.seq": { $ne: input.seq } },
        { $push: { chunks: chunk }, $set: { endedAt } },
      );
      if (updated) return { kind: "added", recording: updated, chunk };
      // Lost a race with the same retry: the other write landed first.
      const raced = await recordings.findOne({ _id: id });
      const landed = raced?.chunks.find((each) => each.seq === input.seq);
      if (!raced || !landed) return { kind: "missing" };
      return { kind: "existing", recording: raced, chunk: landed };
    },

    listRecent({ limit = 50 }: { limit?: number } = {}): Promise<RecordingDoc[]> {
      return recordings.find({}, { sort: { startedAt: -1 }, limit }).toArray();
    },
  };
}

export type RecordingsRepo = ReturnType<typeof recordingsRepo>;
