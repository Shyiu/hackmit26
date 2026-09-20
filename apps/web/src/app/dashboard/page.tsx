import { locationStatus, type LocationStatus } from "@memory-glasses/db";
import {
  BarChart3,
  Clock,
  Glasses,
  Hand,
  MapPin,
  PackageOpen,
  ShieldAlert,
  Repeat,
  ScanFace,
  Laptop,
  MessageCircleQuestion,
  MessageSquareHeart,
  Search,
  Settings,
  TriangleAlert,
  Video,
} from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { RoleChip, Wordmark } from "@/components/brand";
import { CaptureBadge } from "@/components/dashboard/capture-badge";
import { WeeklyMetric, type Trend } from "@/components/home/weekly-metric";
import { NotificationCenter, type CenterEntry } from "@/components/home/notification-center";
import { SectionTitle, ShortcutStrip, Tile } from "@/components/home/tiles";
import { STATUS_LABELS, whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";

export const metadata = { title: "Home" };

// Statuses where the wearer would hear an uncertain answer.
const NEEDS_A_LOOK: LocationStatus[] = ["held", "moved", "uncertain", "unseen"];

const SHORTCUTS = [
  { href: "/wear", label: "Wear page", icon: Glasses },
  { href: "/dashboard/recordings", label: "Recordings", icon: Clock },
  { href: "/dashboard/latency", label: "Latency", icon: BarChart3 },
  { href: "/sim", label: "Simulator", icon: Laptop },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, muted: true },
];

const PAGE = 200;

// Every question in the window, newest first, fetched a page at a time.
async function recentQuestions(tenant: Awaited<ReturnType<typeof dashboardTenant>>["tenant"], since: Date) {
  const all = [];
  let before: Date | undefined;
  for (let page = 0; page < 5; page++) {
    const batch = await tenant.interactions.listRecent({ limit: PAGE, before });
    all.push(...batch.filter((question) => question.askedAt >= since));
    const oldest = batch.at(-1);
    if (batch.length < PAGE || !oldest || oldest.askedAt < since) break;
    before = oldest.askedAt;
  }
  return all;
}

export default async function DashboardHomePage() {
  const { tenant, patient } = await dashboardTenant("/dashboard");
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const dayAgo = now.getTime() - DAY;
  const monthAgo = now.getTime() - 28 * DAY;
  const [items, questions, notifications, openAlerts] = await Promise.all([
    tenant.items.list(),
    recentQuestions(tenant, new Date(monthAgo)),
    tenant.notifications.listRecent({ limit: 20 }),
    tenant.dangerEvents.countOpen(),
  ]);

  const needsALook = items.filter((item) => NEEDS_A_LOOK.includes(locationStatus(item.lastSighting)));

  // Lookups in the last day, counted per item. The same item asked about again
  // and again is what "losing track of things" looks like from here.
  const askedToday = new Map<string, number>();
  for (const question of questions) {
    if (question.askedAt.getTime() < dayAgo || !question.itemId) continue;
    const key = question.itemId.toHexString();
    askedToday.set(key, (askedToday.get(key) ?? 0) + 1);
  }
  const repeats = [...askedToday.entries()]
    .filter(([, count]) => count >= 2)
    .map(([key, count]) => ({ name: items.find((item) => item._id.toHexString() === key)?.name ?? "an item", count }))
    .sort((a, b) => b.count - a.count);
  const lookups = [...askedToday.values()].reduce((sum, count) => sum + count, 0);
  const leftBehind = items
    .filter((item) => item.lastSighting && locationStatus(item.lastSighting) === "observed")
    .sort((a, b) => (b.lastSighting?.lastSeenAt.getTime() ?? 0) - (a.lastSighting?.lastSeenAt.getTime() ?? 0))[0];
  const alerts = notifications.filter((n) => n.kind === "danger_alert" && n.showAt.getTime() >= dayAgo);

  // Four weeks of lookups for a named item, oldest first. A lookup is the
  // wearer asking where something is, so it stands in for having lost it.
  const counts = [0, 0, 0, 0];
  for (const question of questions) {
    if (!question.itemId) continue;
    const weeksAgo = Math.floor((now.getTime() - question.askedAt.getTime()) / (7 * DAY));
    if (weeksAgo >= 0 && weeksAgo < 4) counts[3 - weeksAgo] += 1;
  }
  const thisWeek = counts[3] ?? 0;
  const before = counts.slice(0, 3);
  const baseline = before.reduce((sum, n) => sum + n, 0) / 3;
  const trend: Trend =
    thisWeek - baseline >= 3 && thisWeek >= baseline * 1.5
      ? "up-sharp"
      : thisWeek > baseline * 1.15
        ? "up"
        : thisWeek < baseline * 0.75
          ? "down"
          : "flat";
  const weeks = counts.map((count, index) => ({ label: `w${index}`, count }));
  const summary =
    baseline === 0 && thisWeek === 0
      ? "No lookups in the last month."
      : baseline === 0
        ? "Up from none in the three weeks before."
        : `Usually ${Math.round(baseline)} a week over the last month.`;

  const entries: CenterEntry[] = [
    ...(openAlerts > 0
      ? [
          {
            id: "open-alerts",
            tone: "alert" as const,
            icon: TriangleAlert,
            title: `${openAlerts} open ${openAlerts === 1 ? "alert" : "alerts"}`,
            detail: "Hazards the camera raised that nobody has acknowledged.",
            href: "/dashboard/alerts",
          },
        ]
      : []),
    ...alerts.slice(0, 3).map((alert) => ({
      id: alert._id.toHexString(),
      tone: "alert" as const,
      icon: ShieldAlert,
      title: alert.text,
      detail: relativeTime(alert.showAt, now),
      href: "/dashboard/alerts",
    })),
    repeats.length > 0
      ? {
          id: "tracking",
          tone: "alert",
          icon: Repeat,
          title: "Losing track of things today",
          detail: repeats.map((r) => `${r.name} ${r.count} times`).join(", "),
          href: "/dashboard/questions",
        }
      : {
          id: "tracking",
          tone: "ok",
          icon: Search,
          title: lookups === 0 ? "No lookups today" : "Not losing track today",
          detail:
            lookups === 0
              ? "The wearer hasn't asked where anything is."
              : `${lookups} ${lookups === 1 ? "lookup" : "lookups"}, none repeated.`,
        },
    {
      id: "safe-area",
      tone: "note",
      icon: MapPin,
      title: "Safe area not set up yet",
      detail: "Add one in Settings to hear when they leave it.",
      href: "/dashboard/settings",
    },
    leftBehind?.lastSighting
      ? {
          id: "left-behind",
          tone: "note",
          icon: PackageOpen,
          title: `Last left behind: ${leftBehind.name}`,
          detail: `${whereLine(leftBehind.lastSighting)}, ${relativeTime(leftBehind.lastSighting.lastSeenAt, now)}`,
          href: `/dashboard/items/${leftBehind._id.toHexString()}`,
        }
      : {
          id: "left-behind",
          tone: "note",
          icon: PackageOpen,
          title: "Nothing left behind yet",
          detail: "Items show up here once the camera sees them put down.",
        },
  ];

  return (
    <div className="flex flex-col gap-7">
      <AutoRefresh intervalMs={5000} />

      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Wordmark className="text-base" />
          <RoleChip label="★ Caring" value={patient?.displayName ?? "Wearer"} />
        </div>
        <CaptureBadge compact className="shrink-0" />
      </header>

      <div className="flex min-h-[calc(100dvh-13rem)] flex-col gap-6 md:min-h-0">
        <div className="grid h-[42dvh] min-h-72 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-3 md:h-80">
          <WeeklyMetric thisWeek={thisWeek} weeks={weeks} trend={trend} summary={summary} />
          <NotificationCenter entries={entries} />
        </div>
        <section className="flex flex-1 flex-col justify-center gap-3 pb-6 md:flex-none">
          <Tile href="/dashboard/items" title="Find items" icon={Search} tone="royal" size="wide" />
          <div className="grid grid-cols-4 gap-3">
            <Tile href="/dashboard/live" title="3D Render" icon={Video} tone="navy" size="square" />
            <Tile href="/dashboard/questions" title="Questions" icon={MessageCircleQuestion} tone="sky" size="square" />
            <Tile href="/dashboard/messages" title="Messages" icon={MessageSquareHeart} tone="butter" size="square" />
            <Tile href="/dashboard/people" title="Faces" icon={ScanFace} tone="ice" size="square" />
          </div>
        </section>
      </div>

      <ShortcutStrip shortcuts={SHORTCUTS} />

      {needsALook.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Needs a look</SectionTitle>
          <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:px-0">
            {needsALook.map((item) => {
              const status = locationStatus(item.lastSighting);
              return (
                <li key={item._id.toHexString()} className="w-[78%] shrink-0 snap-start sm:w-72">
                  <Link
                    href={`/dashboard/items/${item._id.toHexString()}`}
                    className="flex h-full gap-4 rounded-3xl border-2 border-border p-4 hover:border-brand/40"
                  >
                    <Hand className="mt-1 size-7 shrink-0 text-brand" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-lg font-semibold capitalize">{item.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {STATUS_LABELS[status]}
                        {item.lastSighting && `, ${relativeTime(item.lastSighting.lastSeenAt, now)}`}
                      </span>
                      <span className="mt-2 self-end text-sm font-semibold text-brand-deep">View</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
