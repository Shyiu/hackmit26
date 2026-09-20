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
    <section aria-label="Weekly results" className="flex min-w-0 flex-col gap-3 rounded-[0.5rem] bg-brand-soft p-3">
      <h2 className="text-sm font-semibold text-brand-deep">This week</h2>
      <div className="flex flex-col">
        <span className="text-5xl leading-none font-bold tracking-tight text-brand-deep tabular-nums">{thisWeek}</span>
        <span className="mt-1 text-sm leading-snug text-foreground/70">
          {thisWeek === 1 ? "time" : "times"} they lost track of something
        </span>
      </div>
      <span className={cn("inline-flex items-center gap-1.5 self-start rounded-[0.4rem] px-2 py-1 text-sm font-semibold", tone)}>
        <Icon className="size-4" />
        {label}
      </span>
      <ul className="mt-auto flex h-16 items-end gap-2" aria-label="Last four weeks">
        {weeks.map((week, index) => (
          <li key={week.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs text-foreground/70 tabular-nums">{week.count}</span>
            <span
              className={cn("w-full rounded-[0.25rem]", index === weeks.length - 1 ? "bg-brand" : "bg-[#9db8ee]")}
              style={{ height: `${Math.max(6, (week.count / max) * 100) * 0.55}%` }}
            />
          </li>
        ))}
      </ul>
      <p className="text-xs leading-snug text-foreground/70">{summary}</p>
    </section>
  );
}
