import { BellRing, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type CenterEntry = {
  id: string;
  tone: "alert" | "danger" | "note" | "ok";
  icon: LucideIcon;
  title: string;
  detail: string;
  href?: string;
};

const TONES: Record<CenterEntry["tone"], string> = {
  alert: "bg-butter text-[#3a2c00]",
  danger: "bg-red-600 text-white",
  note: "bg-brand-soft text-brand-deep",
  ok: "bg-[#e3f3fc] text-brand-deep",
};

// A running list of what the caregiver should know right now, newest concerns
// first. It scrolls inside itself so it never pushes the buttons off the screen.
export function NotificationCenter({ entries }: { entries: CenterEntry[] }) {
  return (
    <section aria-label="Notifications" className="flex min-h-0 min-w-0 flex-col gap-2">
      <h2 className="flex items-center gap-2 px-1 text-sm font-semibold text-brand-deep">
        <BellRing className="size-4" />
        Notifications
      </h2>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1 [-webkit-overflow-scrolling:touch]">
        {entries.map(({ id, tone, icon: Icon, title, detail, href }) => {
          const body = (
            <>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[0.4rem]", TONES[tone])}>
                <Icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm leading-snug font-semibold">{title}</span>
                <span className="text-sm leading-snug text-muted-foreground">{detail}</span>
              </span>
            </>
          );
          const row = "flex flex-col items-start gap-2 rounded-[0.5rem] border border-border bg-card p-2.5";
          return (
            <li key={id}>
              {href ? (
                <Link href={href} className={cn(row, "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none")}>
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
