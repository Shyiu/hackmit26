import { locationStatus } from "@memory-glasses/db";
import { ChevronRight, KeyRound, Plus } from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { EmptyState, ListHeader } from "@/components/dashboard/section";
import { buttonVariants } from "@/components/ui/button";
import { StatusDot } from "@/components/dashboard/status-dot";
import { whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

// The columns the list keeps on wide screens. Name grows, the rest are fixed so
// every row lines up the way Linear's issue list does.
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_8rem_10rem] md:gap-4";

export default async function ItemsPage() {
  const { tenant } = await dashboardTenant("/dashboard/items");
  const items = await tenant.items.list();
  const now = new Date();

  return (
    <>
      <AutoRefresh />
      <PageHeader
        title="Items"
        icon={KeyRound}
        description="Where each tracked item was last seen."
        action={
          // On a phone this shares the header bar with the camera-state pill, so it
          // takes the pill's size there, on touch too. From md up the pill lives in
          // the sidebar and the button goes back to the normal small size.
          <Link
            href="/dashboard/items/new"
            className={cn(
              buttonVariants({ size: "sm" }),
              "h-5 rounded-[0.3rem] px-1.5 pointer-coarse:h-5",
              "md:h-6 md:rounded-md md:px-2 md:pointer-coarse:h-9",
            )}
          >
            <Plus />
            Add item
          </Link>
        }
      />
      <PageBody>
        {items.length === 0 ? (
          <EmptyState>No items yet. Add the things the wearer looks for most, like keys or glasses.</EmptyState>
        ) : (
          <div className="-mx-4 border-y border-hairline md:mx-0 md:overflow-hidden md:rounded-lg md:border">
            <ListHeader className={cn(COLUMNS, "hidden md:grid")}>
              <span>Name</span>
              <span>Where</span>
              <span>Status</span>
              <span>Last seen</span>
            </ListHeader>
            <ul className="divide-y divide-hairline">
              {items.map((item) => {
                const status = locationStatus(item.lastSighting);
                return (
                  <li key={item._id.toHexString()}>
                    <Link
                      href={`/dashboard/items/${item._id.toHexString()}`}
                      className={cn(
                        "group px-4 py-2.5 text-sm transition-colors hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-none md:px-3",
                        COLUMNS,
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium capitalize">{item.name}</span>
                        {item.aliases.length > 0 && (
                          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
                            {item.aliases.join(", ")}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center justify-end gap-2 text-xs text-muted-foreground md:order-4 md:justify-between">
                        {item.lastSighting ? relativeTime(item.lastSighting.lastSeenAt, now) : "Never seen"}
                        <ChevronRight className="hidden size-3.5 transition-transform group-hover:translate-x-0.5 md:block" />
                      </span>
                      <span className="min-w-0 truncate text-muted-foreground md:order-2">
                        {whereLine(item.lastSighting)}
                      </span>
                      <StatusDot status={status} className="justify-self-end text-xs text-muted-foreground md:order-3 md:justify-self-start md:text-sm" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </PageBody>
    </>
  );
}
