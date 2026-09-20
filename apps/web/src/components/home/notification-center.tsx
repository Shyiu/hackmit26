import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type CenterEntry = {
  id: string;
  tone: "alert" | "note" | "ok";
  icon: LucideIcon;
  title: string;
  detail: string;
  href?: string;
};

const TONES: Record<CenterEntry["tone"], string> = {
  alert: "bg-butter text-[#3a2c00]",
  note: "bg-brand-soft text-brand-deep",
  ok: "bg-[#e3f3fc] text-brand-deep",
};

// A running list of what the caregiver should know right now, newest concerns
// first. It scrolls inside itself so it never pushes the buttons off the screen.
export function NotificationCenter({ entries }: { entries: CenterEntry[] }) {
  return (
    <section
      aria-label="Notifications"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-hairline bg-panel"
    >
      <h2 className="flex h-8 shrink-0 items-center border-b border-hairline px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Notifications
      </h2>
      <ul className="flex min-h-0 flex-1 flex-col divide-y divide-hairline overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {entries.map(({ id, tone, icon: Icon, title, detail, href }) => {
          const body = (
            <>
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-[0.25rem]", TONES[tone])}>
                <Icon className="size-3" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm leading-snug font-medium">{title}</span>
                <span className="text-xs leading-snug text-muted-foreground">{detail}</span>
              </span>
            </>
          );
          const row = "flex items-start gap-2 px-3 py-2";
          return (
            <li key={id}>
              {href ? (
                <Link
                  href={href}
                  className={cn(row, "transition-colors hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-none")}
                >
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
