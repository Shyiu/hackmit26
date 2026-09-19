import { Glasses, Smartphone } from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { dayAndTime } from "@/lib/format";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";
import { recordingView, type RecordingUploadState } from "@/lib/server/views";
import { cn } from "@/lib/utils";

const UPLOAD_LABELS: Record<RecordingUploadState, string> = {
  empty: "Registered, no video yet",
  uploading: "Uploading",
  complete: "Uploaded",
};
const UPLOAD_VARIANTS: Record<RecordingUploadState, "default" | "secondary" | "outline"> = {
  empty: "outline",
  uploading: "secondary",
  complete: "default",
};

function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

// Recordings that left the phone, with how much of each has landed. There's no
// player and no live feed here: this is a list of what was stored, and when it
// expires under the retention setting.
export default async function RecordingsPage() {
  const { tenant, settings } = await dashboardTenant("/dashboard/recordings");
  const recordings = (await tenant.recordings.listRecent()).map(recordingView);
  const now = new Date();
  const uploadOn = settings.recordingAllowed && settings.recordingUploadEnabled === true;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <AutoRefresh />
      <PageHeader title="Recordings" description="Video the chest phone recorded and uploaded." />

      <p className="text-sm text-muted-foreground">
        {!settings.recordingAllowed
          ? "Recording is off in Settings. Nothing new is recorded."
          : uploadOn
            ? `Finished recordings upload from the phone and are kept for ${settings.retentionDays} days.`
            : "Upload is off in Settings. Recordings stay on the phone; nothing new arrives here."}
      </p>

      {recordings.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-xl p-5 ring-1 ring-foreground/10">
          <Smartphone className="size-6 text-muted-foreground" />
          <p className="text-base">Nothing has been uploaded yet.</p>
          <p className="text-sm text-muted-foreground">
            Open the wear page on the chest phone to record. With upload off, save a recording to the phone&apos;s
            photos or share it from there.
          </p>
          <Link href="/wear" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto sm:self-start")}>
            <Glasses />
            Open the wear page
          </Link>
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {recordings.map((recording) => (
            <li key={recording._id} className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <time dateTime={recording.startedAt}>
                  {dayAndTime(new Date(recording.startedAt), settings.timezone)} ·{" "}
                  {relativeTime(new Date(recording.startedAt), now)}
                </time>
                <Badge variant={UPLOAD_VARIANTS[recording.uploadState]}>{UPLOAD_LABELS[recording.uploadState]}</Badge>
              </div>
              <p className="text-base tabular-nums">
                {duration(recording.uploadedMs)} uploaded, {megabytes(recording.bytes)} in {recording.chunkCount}{" "}
                {recording.chunkCount === 1 ? "part" : "parts"}
              </p>
              <p className="text-xs text-muted-foreground">
                {recording.width}×{recording.height}, {recording.mimeType}. Kept until{" "}
                {dayAndTime(new Date(recording.expiresAt), settings.timezone)}.
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
