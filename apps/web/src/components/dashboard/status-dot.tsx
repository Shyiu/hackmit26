import type { LocationStatus } from "@memory-glasses/db";
import { STATUS_DOTS, STATUS_LABELS } from "@/lib/item-status";
import { cn } from "@/lib/utils";

// A coloured dot and the status in plain text. Every row gets the same shape, so
// a column of them scans as one, and only the colour carries the confidence.
export function StatusDot({ status, className }: { status: LocationStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOTS[status])} />
      {STATUS_LABELS[status]}
    </span>
  );
}
