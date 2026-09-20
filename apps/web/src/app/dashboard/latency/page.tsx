import { TIMING_STAGES, type TimingStage } from "@memory-glasses/db";
import { Gauge } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { milliseconds } from "@/lib/format";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

const WINDOWS = [1, 7, 30] as const;
type Window = (typeof WINDOWS)[number];

const STAGE_LABELS: Record<TimingStage, { name: string; hint: string }> = {
  stt: { name: "Speech to text", hint: "End of speech to final transcript" },
  intent: { name: "Intent", hint: "Working out which item was asked about" },
  db: { name: "Lookup", hint: "Finding the item and its last sighting" },
  llmFirstToken: { name: "LLM first token", hint: "Slow path only" },
  ttsFirstByte: { name: "Voice first byte", hint: "Text in, first audio byte out" },
  clientFirstPlayback: { name: "First sound", hint: "Reported by the phone" },
  total: { name: "Total", hint: "Server time, end to end" },
};

function parseWindow(value: string | string[] | undefined): Window {
  const days = Number(value);
  return WINDOWS.find((window) => window === days) ?? 7;
}

export default async function LatencyPage({ searchParams }: PageProps<"/dashboard/latency">) {
  const days = parseWindow((await searchParams).days);
  const { tenant } = await dashboardTenant(`/dashboard/latency?days=${days}`);
  const now = new Date();
  const stats = await tenant.interactions.latencyStats({ since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) });

  return (
    <>
      <PageHeader
        title="Latency"
        icon={Gauge}
        description={`P50 and P95 per stage over ${stats.interactions} answered question${stats.interactions === 1 ? "" : "s"}.`}
        action={
          <nav aria-label="Time window" className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {WINDOWS.map((window) => (
              <Link
                key={window}
                href={`/dashboard/latency?days=${window}`}
                aria-current={window === days ? "page" : undefined}
                className={cn(
                  "flex h-6 items-center justify-center rounded-[0.3rem] px-2 text-xs font-medium transition-colors",
                  window === days
                    ? "bg-panel text-foreground shadow-[0_1px_2px_rgb(20_45_120/0.12)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {window === 1 ? "24 hours" : `${window} days`}
              </Link>
            ))}
          </nav>
        }
      />
      <PageBody>
      <div className="flex flex-col divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
        <div className="hidden grid-cols-[1fr_6rem_6rem_6rem] gap-4 bg-row-hover/60 px-3 py-1.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Stage</span>
          <span className="text-right">P50</span>
          <span className="text-right">P95</span>
          <span className="text-right">Samples</span>
        </div>
        {TIMING_STAGES.map((stage) => {
          const row = stats.stages[stage];
          const label = STAGE_LABELS[stage];
          return (
            <div
              key={stage}
              className={cn(
                "grid grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5 md:grid-cols-[1fr_6rem_6rem_6rem] md:items-center",
                stage === "total" && "bg-muted/50 font-medium",
              )}
            >
              <div className="col-span-3 md:col-span-1">
                <p className="text-sm font-medium">{label.name}</p>
                <p className="text-xs text-muted-foreground">{label.hint}</p>
              </div>
              <Stat label="P50" value={milliseconds(row.p50)} />
              <Stat label="P95" value={milliseconds(row.p95)} />
              <Stat label="Samples" value={row.samples.toLocaleString("en-US")} muted={row.samples === 0} />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Stage percentiles don&apos;t add up to the total&apos;s percentile, so Total is measured on its own. Stages with no
        samples haven&apos;t been built or haven&apos;t run in this window.
      </p>
      </PageBody>
    </>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col md:text-right">
      <span className="text-xs text-muted-foreground md:sr-only">{label}</span>
      <span className={cn("text-sm tabular-nums", muted && "text-muted-foreground")}>{value}</span>
    </div>
  );
}
