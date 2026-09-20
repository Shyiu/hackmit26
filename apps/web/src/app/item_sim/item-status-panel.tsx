"use client";

import type { Detection } from "@memory-glasses/shared";
import type { ItemStatus } from "@/hooks/use-item-statuses";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, STATUS_VARIANTS, whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

// Descriptions run in the background, so a fresh sighting shows here before
// its sentence does. This turns "pending" into a live progress step instead
// of looking stuck.
function descriptionLine(item: ItemStatus): string | null {
  if (!item.lastSighting) return null;
  if (item.lastSighting.descriptionStatus === "pending") return "Confirmed — describing where it is…";
  if (item.lastSighting.descriptionStatus === "failed") return "Confirmed, but the vision model couldn't describe it";
  return null;
}

/** Shows /api/items state so a dev can watch a sighting go from detected to logged, without asking a question. */
export function ItemStatusPanel({
  detections,
  items,
  error,
}: {
  detections: Detection[];
  items: ItemStatus[] | null;
  error: string | null;
}) {
  const seenNow = new Set(detections.map((detection) => detection.itemId));

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!items) return <p className="text-sm text-muted-foreground">Loading items…</p>;
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No active items. Add one from the dashboard first.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border">
      {items.map((item) => {
        const inFrame = seenNow.has(item._id);
        const progress = descriptionLine(item);
        return (
          <li key={item._id} className={cn("flex flex-col gap-1 p-3 transition-colors", inFrame && "bg-emerald-500/10")}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", inFrame ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/30")} />
                <span className="font-medium capitalize">{item.name}</span>
                {inFrame && <span className="text-xs text-emerald-600 dark:text-emerald-400">in frame now</span>}
              </div>
              <Badge variant={STATUS_VARIANTS[item.locationStatus]}>{STATUS_LABELS[item.locationStatus]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {progress ?? whereLine(item.lastSighting)}
              {item.lastSighting && ` · ${relativeTime(new Date(item.lastSighting.lastSeenAt), new Date())}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
