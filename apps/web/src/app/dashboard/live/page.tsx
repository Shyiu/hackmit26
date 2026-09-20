import { Video } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { EmptyState, Section, listBlockClass } from "@/components/dashboard/section";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function LivePage() {
  const { tenant } = await dashboardTenant("/dashboard/live");
  const items = await tenant.items.list();
  const now = new Date();

  return (
    <>
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="3D Render"
        icon={Video}
        description="A 3D view of the house that shows the way to a chosen item."
      />
      <PageBody>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        {/* Intentionally empty: the 3D render goes here. */}
        <div
          aria-label="3D render"
          className="h-[26rem] min-w-0 rounded-lg border border-hairline bg-muted/40 sm:h-[32rem]"
        />
        <Section title="Find an item">
          {items.length === 0 ? (
            <EmptyState>No items yet.</EmptyState>
          ) : (
            <ul className={listBlockClass}>
              {items.map((item) => (
                <li
                  key={item._id.toHexString()}
                  className="flex flex-col gap-0.5 px-3 py-2 transition-colors hover:bg-row-hover"
                >
                  <span className="text-sm font-medium capitalize">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.lastSighting
                      ? `${item.lastSighting.room ?? "Unknown room"} · ${relativeTime(item.lastSighting.lastSeenAt, now)}`
                      : "Not seen yet"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      </PageBody>
    </>
  );
}
