import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A titled group on a dashboard page. The title is a small muted label, the way
// Linear labels a group of issues, and the rows below carry the weight.
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Linear's list: a hairline-bordered block of rows, each divided from the next
// and lit only on hover.
export const rowListClass = "flex flex-col divide-y divide-hairline overflow-hidden rounded-lg border border-hairline";

export const rowLinkClass =
  "flex items-center justify-between gap-4 px-3 py-2.5 text-sm transition-colors hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

export const textLinkClass = "text-sm font-medium text-brand underline-offset-4 hover:underline";

// The card every page uses for a standalone block of content.
export const panelClass = "rounded-lg border border-hairline bg-panel";

// Shown where a list has nothing in it yet: what is missing and what to do.
export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("rounded-lg border border-dashed border-hairline px-3 py-8 text-center text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}

// The column-header strip above a Linear-style list.
export function ListHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-hairline bg-row-hover/60 px-3 py-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
