import { createRecordingSchema } from "@memory-glasses/shared";
import { HttpError, readBody, withTenant } from "@/lib/server/api";
import { recordingView } from "@/lib/server/views";

// Optional, after M3. GET: the caregiver lists recordings that left the phone.
// POST: the phone registers one that's about to. The caregiver's settings gate
// both recording and upload; with either off, the recording stays on the phone.
export const GET = withTenant("caregiver", async ({ tenant }) => {
  const recordings = await tenant.recordings.listRecent();
  return Response.json({ recordings: recordings.map(recordingView) });
});

export const POST = withTenant("any", async ({ request, principal, tenant, settings }) => {
  const input = await readBody(request, createRecordingSchema);
  if (!settings.recordingAllowed) throw new HttpError(403, "Recording is off in this wearer's settings");
  if (settings.recordingUploadEnabled !== true) {
    throw new HttpError(403, "Recording upload is off in this wearer's settings; recordings stay on the phone");
  }
  const { recording, created } = await tenant.recordings.create({
    ...input,
    deviceId: principal.kind === "device" ? principal.deviceId : null,
  });
  return Response.json(recordingView(recording), { status: created ? 201 : 200 });
});
