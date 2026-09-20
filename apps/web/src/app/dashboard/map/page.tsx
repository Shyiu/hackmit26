import { Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { ScanPanel } from "@/components/dashboard/scan-panel";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

const VIEWS = [
  { mode: "static", label: "Room scan" },
  { mode: "live", label: "Live scan" },
] as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// The view and the focused item live in the URL, so a link can open either.
function mapHref(mode: "static" | "live", item: string | undefined) {
  const query = new URLSearchParams();
  if (mode === "live") query.set("view", "live");
  if (item) query.set("item", item);
  const search = query.toString();
  return search ? `/dashboard/map?${search}` : "/dashboard/map";
}

export default async function MapPage({ searchParams }: PageProps<"/dashboard/map">) {
  const query = await searchParams;
  const mode = first(query.view) === "live" ? "live" : "static";
  const item = first(query.item);
  await dashboardTenant(mapHref(mode, item));

  return (
    <>
      <PageHeader
        title="Map"
        icon={MapIcon}
        description="A 3D scan of the room. Each arrow points at where an item was last seen."
        action={
          <nav aria-label="Scan" className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {VIEWS.map((view) => (
              <Link
                key={view.mode}
                href={mapHref(view.mode, item)}
                aria-current={view.mode === mode ? "page" : undefined}
                className={cn(
                  "flex h-6 items-center justify-center rounded-[0.3rem] px-2 text-xs font-medium transition-colors",
                  view.mode === mode
                    ? "bg-panel text-foreground shadow-[0_1px_2px_rgb(20_45_120/0.12)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {view.label}
              </Link>
            ))}
          </nav>
        }
      />
      <PageBody>
        {/* Fills what the header, the padding and the phone's tab bar leave. */}
        <ScanPanel
          mode={mode}
          focusItemId={item}
          className="h-[max(60vh,calc(100dvh-13rem))] md:h-[calc(100dvh-9rem)] md:min-h-96"
        />
      </PageBody>
    </>
  );
}
