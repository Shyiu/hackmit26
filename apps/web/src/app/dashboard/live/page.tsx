import { Video } from "lucide-react";
import Link from "next/link";
import { LiveDiagnostics } from "@/components/dashboard/live-diagnostics";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { ScanPanel } from "@/components/dashboard/scan-panel";
import { EmptyState, Section, listBlockClass } from "@/components/dashboard/section";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

const VIEWS = [
  { view: "live", label: "Live view" },
  { view: "3d", label: "3D view" },
] as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function liveHref(view: "live" | "3d", item: string | undefined) {
  const query = new URLSearchParams();
  if (view === "3d") query.set("view", "3d");
  if (item) query.set("item", item);
  const search = query.toString();
  return search ? `/dashboard/live?${search}` : "/dashboard/live";
}

export default async function LivePage({ searchParams }: PageProps<"/dashboard/live">) {
  const query = await searchParams;
  const view = first(query.view) === "3d" ? "3d" : "live";
  const item = first(query.item);
  const { tenant } = await dashboardTenant(liveHref(view, item));

  return (
    <>
      <PageHeader
        title="Live"
        icon={Video}
        description={
          view === "live"
            ? "Whether the phone is connected and each item's status, to see what is and isn't working."
            : "A 3D view of the house that shows the way to a chosen item."
        }
        action={
          <nav aria-label="Live" className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {VIEWS.map((tab) => (
              <Link
                key={tab.view}
                href={liveHref(tab.view, item)}
                aria-current={tab.view === view ? "page" : undefined}
                className={cn(
                  "flex h-6 items-center justify-center rounded-[0.3rem] px-2 text-xs font-medium transition-colors",
                  tab.view === view
                    ? "bg-panel text-foreground shadow-[0_1px_2px_rgb(20_45_120/0.12)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        }
      />
      <PageBody>
        {view === "live" ? (
          <LiveDiagnostics />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <ScanPanel
              mode="auto"
              focusItemId={item}
              className="h-[max(60vh,calc(100dvh-13rem))] md:h-[calc(100dvh-9rem)] md:min-h-96"
            />
            <ItemPicker item={item} tenant={tenant} />
          </div>
        )}
      </PageBody>
    </>
  );
}

async function ItemPicker({ item, tenant }: { item: string | undefined; tenant: Awaited<ReturnType<typeof dashboardTenant>>["tenant"] }) {
  const items = await tenant.items.list();
  const now = new Date();
  return (
    <Section title="Find an item">
      {items.length === 0 ? (
        <EmptyState>No items yet.</EmptyState>
      ) : (
        <ul className={listBlockClass}>
          {items.map((doc) => (
            <li key={doc._id.toHexString()}>
              <Link
                href={liveHref("3d", doc._id.toHexString())}
                aria-current={item === doc._id.toHexString() ? "page" : undefined}
                className={cn(
                  "flex flex-col gap-0.5 px-3 py-2 transition-colors hover:bg-row-hover",
                  item === doc._id.toHexString() && "bg-row-hover",
                )}
              >
                <span className="text-sm font-medium capitalize">{doc.name}</span>
                <span className="text-xs text-muted-foreground">
                  {doc.lastSighting
                    ? `${doc.lastSighting.room ?? "Unknown room"} · ${relativeTime(doc.lastSighting.lastSeenAt, now)}`
                    : "Not seen yet"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
