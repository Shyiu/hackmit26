import { Bell, Camera, CameraOff, Pause } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { clockTime } from "@/lib/format";
import { INTERACTION_LABELS, INTERACTION_VARIANTS } from "@/lib/interaction-status";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";
import { captureView, type CaptureState } from "@/lib/server/views";
import { sightingPhrase } from "@/lib/sighting-words";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<CaptureState, string> = {
  live: "Camera live",
  paused: "Camera paused",
  offline: "Camera offline",
};

function secondsAgo(then: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 90) return `${seconds} s ago`;
  return relativeTime(then, now);
}

export default async function LivePage() {
  const { tenant, settings } = await dashboardTenant("/dashboard/live");
  const [session, [latest], sightings] = await Promise.all([
    tenant.patient.latestCaptureSession(),
    tenant.interactions.listRecent({ limit: 1 }),
    tenant.sightings.list({ limit: 8 }),
  ]);
  const now = new Date();
  const capture = session ? captureView(session, now) : null;
  const state: CaptureState = capture?.state ?? "offline";
  const StateIcon = state === "live" ? Camera : state === "paused" ? Pause : CameraOff;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={2000} />
      <PageHeader title="Live" description="What the chest camera is doing, and the last thing the wearer heard." />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* The frame area. Video with item labels needs the perception service's /ws/debug. */}
          <section
            aria-label="Camera"
            className="relative flex min-h-64 flex-col justify-between gap-4 sm:aspect-video sm:min-h-0 overflow-hidden rounded-xl bg-neutral-950 p-4 text-neutral-100"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
                  state === "live" && "bg-emerald-500/20 text-emerald-300",
                  state === "paused" && "bg-amber-500/20 text-amber-300",
                  state === "offline" && "bg-white/10 text-neutral-300",
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    state === "live" && "animate-pulse bg-emerald-400",
                    state === "paused" && "bg-amber-400",
                    state === "offline" && "bg-neutral-500",
                  )}
                />
                {STATE_TEXT[state]}
              </span>
              {capture && <span className="text-xs text-neutral-400">from the {capture.source}</span>}
            </div>
            <div className="flex flex-col items-center gap-2 text-center text-neutral-400">
              <StateIcon className="size-8" />
              <p className="max-w-xs text-sm">Video with item labels arrives with the perception service&apos;s /ws/debug stream.</p>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
              <div>
                <dt className="text-neutral-400">Frames</dt>
                <dd className="tabular-nums">{capture?.framesReceived.toLocaleString("en-US") ?? "–"}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Dropped</dt>
                <dd className="tabular-nums">{capture?.framesDropped.toLocaleString("en-US") ?? "–"}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Last frame</dt>
                <dd className="tabular-nums">
                  {capture?.lastFrameAt ? secondsAgo(new Date(capture.lastFrameAt), now) : "none yet"}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Last answer" className="flex flex-col gap-3 rounded-xl p-5 ring-1 ring-foreground/10">
            {latest ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    Asked at {clockTime(latest.askedAt, settings.timezone)}, {relativeTime(latest.askedAt, now)}
                  </span>
                  <Badge variant={INTERACTION_VARIANTS[latest.status]}>{INTERACTION_LABELS[latest.status]}</Badge>
                </div>
                <p className="text-base text-muted-foreground">“{latest.transcript}”</p>
                <p className="text-2xl leading-snug font-semibold text-balance sm:text-3xl">
                  {latest.answerText ?? (latest.error ? "I need a moment." : "…")}
                </p>
                {latest.error && <p className="text-sm text-destructive">{latest.error.message}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">No questions yet. The wearer&apos;s next question and its answer show here.</p>
            )}
          </section>
        </div>

        <section aria-label="Sighting notifications" className="flex min-w-0 flex-col gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Bell className="size-4" />
            Sightings
          </h2>
          <p className="text-sm text-muted-foreground">Shown here only. Speaking them would nag the wearer.</p>
          {sightings.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing seen recently.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {sightings.map((sighting) => (
                <li key={sighting._id.toHexString()} className="rounded-xl p-3 ring-1 ring-foreground/10">
                  <p className="text-sm font-medium first-letter:uppercase">{sightingPhrase(sighting)}</p>
                  <p className="text-sm text-muted-foreground">
                    {relativeTime(sighting.lastSeenAt, now)}
                    {sighting.status === "open" && " · in view now"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
