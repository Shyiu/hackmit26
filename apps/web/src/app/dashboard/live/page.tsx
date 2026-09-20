import { Navigation } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/dashboard/page-header";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function LivePage() {
  const { tenant } = await dashboardTenant("/dashboard/live");
  const items = await tenant.items.list();
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={5000} />
      <PageHeader title="3D Render" description="A 3D view of the house that shows the way to a chosen item." />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* Intentionally empty: the 3D render goes here. */}
        <div
          aria-label="3D render"
          className="h-[26rem] min-w-0 rounded-3xl bg-card shadow-[0_4px_20px_-8px_rgb(20_45_120/0.15)] ring-1 ring-foreground/5 sm:h-[32rem]"
        />
        <section aria-label="Items" className="flex min-w-0 flex-col gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Navigation className="size-4" />
            Find an item
          </h2>
          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No items yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item._id.toHexString()}
                  className="flex flex-col gap-0.5 rounded-2xl bg-card p-3 ring-1 ring-foreground/5"
                >
                  <span className="font-medium capitalize">{item.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {item.lastSighting
                      ? `${item.lastSighting.room ?? "Unknown room"} · ${relativeTime(item.lastSighting.lastSeenAt, now)}`
                      : "Not seen yet"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
