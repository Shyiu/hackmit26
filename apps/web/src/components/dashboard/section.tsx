import type { ReactNode } from "react";

// A titled group on a dashboard page. Rows inside are separated by dividers,
// not boxed, so a page reads as one column of lists.
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const rowListClass = "flex flex-col divide-y divide-border border-y border-border";

export const rowLinkClass =
  "flex items-center justify-between gap-4 px-2 py-4 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

export const textLinkClass = "text-sm font-medium text-brand underline-offset-4 hover:underline";

// Shown where a list has nothing in it yet: what is missing and what to do.
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="border-y border-border px-2 py-6 text-sm text-muted-foreground">{children}</p>;
}
