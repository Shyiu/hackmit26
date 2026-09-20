import type { InteractionDoc, ItemDoc } from "@memory-glasses/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { dayAndTime, dayKey, milliseconds, weekdayShort } from "@/lib/format";
import { INTERACTION_LABELS, INTERACTION_VARIANTS } from "@/lib/interaction-status";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";

const DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
// listRecent caps a page at 200; a week of questions fits unless it's an unusual week.
const LOG_LIMIT = 200;

export default async function QuestionsPage() {
  const { tenant, settings } = await dashboardTenant("/dashboard/questions");
  const [interactions, items] = await Promise.all([
    tenant.interactions.listRecent({ limit: LOG_LIMIT }),
    tenant.items.list({ includeArchived: true }),
  ]);
  const now = new Date();
  const names = new Map(items.map((item) => [item._id.toHexString(), item.name]));
  const counts = countByDay(interactions, items, now, settings.timezone);

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh />
      <PageHeader title="Questions" description="What the wearer asked and what they heard." />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Questions per day</h2>
          <p className="text-sm text-muted-foreground">
            A count for each of the last {DAYS} days. It&apos;s a count only, not a measure of health.
          </p>
        </div>
        <CountGrid counts={counts} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Log</h2>
        {interactions.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No questions yet. They show up here as soon as the wearer asks.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {interactions.map((interaction) => (
              <li
                key={interaction._id.toHexString()}
                className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <time dateTime={interaction.askedAt.toISOString()}>
                    {dayAndTime(interaction.askedAt, settings.timezone)} · {relativeTime(interaction.askedAt, now)}
                  </time>
                  <Badge variant={INTERACTION_VARIANTS[interaction.status]}>
                    {INTERACTION_LABELS[interaction.status]}
                  </Badge>
                </div>
                <p className="text-base font-medium">“{interaction.transcript}”</p>
                {interaction.answerText && (
                  <p className="border-l-2 pl-3 text-base text-muted-foreground">{interaction.answerText}</p>
                )}
                {interaction.error && (
                  <p className="text-sm text-destructive">
                    {interaction.error.code}: {interaction.error.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {interaction.itemId ? (names.get(interaction.itemId.toHexString()) ?? "an archived item") : "no item"}
                  {interaction.path && ` · ${interaction.path} path`}
                  {` · ${milliseconds(interaction.timingsMs.total)} total`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

type Counts = { days: { key: string; label: string }[]; rows: { key: string; name: string; perDay: number[] }[] };

function countByDay(interactions: InteractionDoc[], items: ItemDoc[], now: Date, timeZone: string): Counts {
  const days = Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(now.getTime() - (DAYS - 1 - index) * DAY_MS);
    return { key: dayKey(date, timeZone), label: index === DAYS - 1 ? "Today" : weekdayShort(date, timeZone) };
  });
  const column = new Map(days.map((day, index) => [day.key, index]));
  const byItem = new Map<string, number[]>();
  for (const interaction of interactions) {
    const index = column.get(dayKey(interaction.askedAt, timeZone));
    if (index === undefined) continue;
    const key = interaction.itemId?.toHexString() ?? "other";
    const row = byItem.get(key) ?? Array<number>(DAYS).fill(0);
    row[index] = (row[index] ?? 0) + 1;
    byItem.set(key, row);
  }
  const names = new Map(items.map((item) => [item._id.toHexString(), item.name]));
  const rows = [...byItem.entries()]
    .map(([key, perDay]) => ({ key, name: key === "other" ? "other" : (names.get(key) ?? "archived item"), perDay }))
    .sort((a, b) => (a.key === "other" ? 1 : b.key === "other" ? -1 : a.name.localeCompare(b.name)));
  return { days, rows };
}

function CountGrid({ counts }: { counts: Counts }) {
  if (counts.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No questions in the last {DAYS} days.</p>;
  }
  const max = Math.max(1, ...counts.rows.flatMap((row) => row.perDay));
  return (
    <div
      role="table"
      aria-label="Questions per day per item"
      className="grid grid-cols-[minmax(4.5rem,1fr)_repeat(7,minmax(0,2.75rem))] gap-1 text-sm"
    >
      <div role="row" className="contents">
        <span role="columnheader">
          <span className="sr-only">Item</span>
        </span>
        {counts.days.map((day) => (
          <span role="columnheader" key={day.key} className="text-center text-xs text-muted-foreground">
            {day.label}
          </span>
        ))}
      </div>
      {counts.rows.map((row) => (
        <div role="row" key={row.key} className="contents">
          <span role="rowheader" className="flex items-center truncate font-medium capitalize">
            {row.name}
          </span>
          {row.perDay.map((count, index) => (
            <span
              role="cell"
              key={counts.days[index]?.key}
              className="flex h-10 items-center justify-center rounded-md tabular-nums"
              style={{
                backgroundColor:
                  count === 0 ? undefined : `color-mix(in oklch, var(--brand) ${15 + (count / max) * 55}%, transparent)`,
              }}
            >
              {count === 0 ? <span className="text-muted-foreground/60">0</span> : count}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
