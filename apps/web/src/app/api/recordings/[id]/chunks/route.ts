import { recordingChunkKey, type RecordingId } from "@memory-glasses/db";
import { createRecordingChunkSchema, type RecordingChunkUpload } from "@memory-glasses/shared";
import { HttpError, readBody, readId, withTenant } from "@/lib/server/api";
import { presignUpload } from "@/lib/server/storage";
import { toJson } from "@/lib/server/views";

// Records one chunk of a registered recording and returns a signed PUT URL for
// its bytes. The same `seq` again, as when the phone lost the network mid-upload,
// gets a fresh URL for the same key, so the upload resumes instead of restarting.
export const POST = withTenant<{ id: string }>("any", async ({ request, params, tenant, settings }) => {
  const id = readId<RecordingId>(params.id);
  const { final, ...chunk } = await readBody(request, createRecordingChunkSchema);
  if (!settings.recordingAllowed || settings.recordingUploadEnabled !== true) {
    throw new HttpError(403, "Recording upload is off in this wearer's settings");
  }
  const recording = await tenant.recordings.get(id);
  if (!recording) throw new HttpError(404, "Not found");
  // Signing needs the bucket, so it goes first: no bucket, nothing written.
  const signed = await presignUpload({ key: recordingChunkKey(recording, chunk.seq), contentType: recording.mimeType });
  const result = await tenant.recordings.addChunk(id, chunk, { final: final ?? false });
  if (result.kind === "missing") throw new HttpError(404, "Not found");
  const body: RecordingChunkUpload & { headers: Record<string, string> } = {
    recordingId: recording._id.toHexString(),
    seq: result.chunk.seq,
    key: result.chunk.key,
    uploadUrl: signed.url,
    expiresAt: signed.expiresAt,
    headers: signed.headers,
  };
  return Response.json(toJson(body), { status: result.kind === "added" ? 201 : 200 });
});
