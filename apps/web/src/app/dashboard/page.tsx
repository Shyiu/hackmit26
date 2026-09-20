import { locationStatus, type LocationStatus } from "@memory-glasses/db";
import {
  BarChart3,
  Clock,
  ScanFace,
  Glasses,
  Hand,
  KeyRound,
  Laptop,
  MessageCircleQuestion,
  MessageSquareHeart,
  Search,
  Settings,
  Video,
} from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { RoleChip, Wordmark } from "@/components/brand";
import { CaptureBadge } from "@/components/dashboard/capture-badge";
import { pillLinkClass, SectionTitle, ShortcutStrip, TicketCard, Tile } from "@/components/home/tiles";
import { STATUS_LABELS, whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

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

export default async function DashboardHomePage() {
  const { tenant, patient } = await dashboardTenant("/dashboard");
  const [items, [lastQuestion]] = await Promise.all([
    tenant.items.list(),
    tenant.interactions.listRecent({ limit: 1 }),
  ]);
  const now = new Date();

  const needsALook = items.filter((item) => NEEDS_A_LOOK.includes(locationStatus(item.lastSighting)));
  const recent = items
    .filter((item) => item.lastSighting)
    .sort((a, b) => (b.lastSighting?.lastSeenAt.getTime() ?? 0) - (a.lastSighting?.lastSeenAt.getTime() ?? 0))
    .slice(0, 4);

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

      <section className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Tile href="/dashboard/items" title="Find items" icon={Search} tone="terracotta" />
          <Tile href="/dashboard/live" title="Live view" icon={Video} tone="lavender" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Tile href="/dashboard/questions" title="Questions" icon={MessageCircleQuestion} tone="sky" size="small" />
          <Tile href="/dashboard/messages" title="Messages" icon={MessageSquareHeart} tone="butter" size="small" />
          <Tile href="/dashboard/people" title="Faces" icon={ScanFace} tone="mint" size="small" />
        </div>
        <ShortcutStrip shortcuts={SHORTCUTS} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>What they heard last</SectionTitle>
        {lastQuestion ? (
          <TicketCard
            icon={KeyRound}
            title={lastQuestion.answerText ?? "No answer yet"}
            subtitle={`“${lastQuestion.transcript}” · ${relativeTime(lastQuestion.askedAt, now)}`}
            action={
              <Link href="/dashboard/questions" className={pillLinkClass}>
                Log
              </Link>
            }
          />
        ) : (
          <p className="rounded-3xl border-2 border-dashed p-5 text-center text-sm text-muted-foreground">
            No questions yet. They show up here as soon as the wearer asks one.
          </p>
        )}
      </section>

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
                    className="flex h-full gap-4 rounded-3xl border-2 border-border p-4 hover:border-terracotta/40"
                  >
                    <Hand className="mt-1 size-7 shrink-0 text-terracotta" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-lg font-semibold capitalize">{item.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {STATUS_LABELS[status]}
                        {item.lastSighting && `, ${relativeTime(item.lastSighting.lastSeenAt, now)}`}
                      </span>
                      <span className="mt-2 self-end text-sm font-semibold text-terracotta-deep">View</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionTitle
          action={
            <Link href="/dashboard/items" className="text-sm font-semibold text-terracotta-deep">
              See all
            </Link>
          }
        >
          Recently seen
        </SectionTitle>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing seen yet.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            {recent.map((item) => {
              const status = locationStatus(item.lastSighting);
              return (
                <li key={item._id.toHexString()}>
                  <Link
                    href={`/dashboard/items/${item._id.toHexString()}`}
                    className="flex items-center gap-4 rounded-3xl bg-muted p-3 pr-4 hover:bg-secondary"
                  >
                    <span
                      className={cn(
                        "flex size-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold capitalize",
                        status === "observed" ? "bg-terracotta text-white" : "bg-terracotta-soft text-terracotta-deep",
                      )}
                    >
                      {item.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold capitalize">{item.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {whereLine(item.lastSighting)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.lastSighting && relativeTime(item.lastSighting.lastSeenAt, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
