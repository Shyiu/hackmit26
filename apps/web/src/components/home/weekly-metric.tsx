import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Trend = "up-sharp" | "up" | "flat" | "down";

const TREND: Record<Trend, { icon: LucideIcon; label: string; tone: string }> = {
  "up-sharp": { icon: TrendingUp, label: "Rising quickly", tone: "bg-butter text-[#3a2c00]" },
  up: { icon: TrendingUp, label: "Rising", tone: "bg-brand-soft text-brand-deep" },
  flat: { icon: Minus, label: "Steady", tone: "bg-brand-soft text-brand-deep" },
  down: { icon: TrendingDown, label: "Improving", tone: "bg-[#e3f3fc] text-brand-deep" },
};

// How often the wearer lost track of something: this week's count, the four
// weeks as bars, and whether the month is heading up or down.
export function WeeklyMetric({
  thisWeek,
  weeks,
  trend,
  summary,
}: {
  thisWeek: number;
  /** Oldest first, this week last. */
  weeks: { label: string; count: number }[];
  trend: Trend;
  summary: string;
}) {
  const { icon: Icon, label, tone } = TREND[trend];
  const max = Math.max(1, ...weeks.map((week) => week.count));
  return (
    <section
      aria-label="Weekly results"
      className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-hairline bg-panel p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">This week</h2>
        <span className={cn("inline-flex h-5 items-center gap-1 rounded-[0.3rem] px-1.5 text-xs font-medium", tone)}>
          <Icon className="size-3" />
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl leading-none font-semibold tracking-tight text-brand-deep tabular-nums">
          {thisWeek}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">
          {thisWeek === 1 ? "time" : "times"} they lost track of something
        </span>
      </div>
      <ul className="flex min-h-14 flex-1 items-end gap-1.5" aria-label="Last four weeks">
        {weeks.map((week, index) => (
          <li key={week.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs text-muted-foreground tabular-nums">{week.count}</span>
            <span
              className={cn("w-full rounded-[0.2rem]", index === weeks.length - 1 ? "bg-brand" : "bg-[#bcd0f7]")}
              style={{ height: `${Math.max(6, (week.count / max) * 100) * 0.6}%` }}
            />
          </li>
        ))}
      </ul>
      <p className="text-xs leading-snug text-muted-foreground">{summary}</p>
    </section>
  );
}
