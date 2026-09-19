import { locationStatus } from "@memory-glasses/db";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { STATUS_LABELS, STATUS_VARIANTS, whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

export default async function ItemsPage() {
  const { tenant } = await dashboardTenant("/dashboard/items");
  const items = await tenant.items.list();
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />
      <PageHeader
        title="Items"
        description="Where each tracked item was last seen."
        action={
          <Link href="/dashboard/items/new" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
            <Plus />
            Add item
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No items yet. Add the things the wearer looks for most, like keys or glasses.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const status = locationStatus(item.lastSighting);
            const sentence = item.lastSighting?.sentence;
            return (
              <li key={item._id.toHexString()}>
                <Link
                  href={`/dashboard/items/${item._id.toHexString()}`}
                  className="group flex h-full flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold capitalize">{item.name}</h2>
                      {item.aliases.length > 0 && (
                        <p className="truncate text-sm text-muted-foreground">{item.aliases.join(", ")}</p>
                      )}
                    </div>
                    <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
                  </div>
                  <p className={cn("text-base", !sentence && "text-muted-foreground")}>
                    {whereLine(item.lastSighting)}
                  </p>
                  <div className="mt-auto flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {item.lastSighting ? `Seen ${relativeTime(item.lastSighting.lastSeenAt, now)}` : "Never seen"}
                    </span>
                    <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
