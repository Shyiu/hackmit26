import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TileTone = "terracotta" | "lavender" | "sky" | "butter" | "mint";

// Each tone is a pastel card with a saturated quarter-circle rising from the
// bottom-right corner, and the icon standing on it.
const TONES: Record<TileTone, { card: string; blob: string; icon: string }> = {
  terracotta: {
    card: "bg-[#fde3da]",
    blob: "from-[#f6a88c] to-[#c65d3b]",
    icon: "text-white",
  },
  lavender: {
    card: "bg-[#efe4fb]",
    blob: "from-[#c7a4f5] to-[#7b4fd8]",
    icon: "text-white",
  },
  sky: {
    card: "bg-[#dcf1fb]",
    blob: "from-[#93d3f3] to-[#2f86d3]",
    icon: "text-white",
  },
  butter: {
    card: "bg-[#fcf1d3]",
    blob: "from-[#f9cf6f] to-[#e8801f]",
    icon: "text-white",
  },
  mint: {
    card: "bg-[#e7f6d9]",
    blob: "from-[#9fdc84] to-[#3e9b45]",
    icon: "text-white",
  },
};

export function Tile({
  href,
  title,
  icon: Icon,
  tone,
  size = "large",
  children,
}: {
  href: string;
  title: string;
  icon: LucideIcon;
  tone: TileTone;
  size?: "large" | "small";
  children?: ReactNode;
}) {
  const colors = TONES[tone];
  const large = size === "large";
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-w-0 overflow-hidden rounded-[1.75rem] p-4 transition-transform active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none sm:p-5",
        large ? "aspect-[1.45/1]" : "aspect-[1/1]",
        colors.card,
      )}
    >
      <div className="relative z-10 flex flex-col gap-1">
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground text-balance",
            large ? "text-[1.35rem] leading-tight sm:text-2xl" : "text-lg leading-tight sm:text-xl",
          )}
        >
          {title}
        </span>
        {children && <span className="text-sm text-foreground/60">{children}</span>}
      </div>
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-gradient-to-br transition-transform duration-300 group-hover:scale-105",
          large ? "-right-6 -bottom-20 size-36 sm:-bottom-24 sm:size-48" : "-right-7 -bottom-12 size-28 sm:size-32",
          colors.blob,
        )}
      />
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          "absolute drop-shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5",
          large ? "right-5 bottom-3 size-12 sm:size-16" : "right-3 bottom-3 size-10 sm:size-12",
          colors.icon,
        )}
      />
    </Link>
  );
}

export type Shortcut = { href: string; label: string; icon: LucideIcon; muted?: boolean };

// A row of smaller destinations in one raised card.
export function ShortcutStrip({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <nav className="grid grid-cols-5 gap-1 rounded-3xl bg-card px-1 py-4 shadow-[0_4px_20px_-6px_rgb(60_30_20/0.15)] ring-1 ring-foreground/5">
      {shortcuts.map(({ href, label, icon: Icon, muted }) => (
        <Link
          key={href}
          href={href}
          className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1 text-center text-xs leading-tight font-medium text-foreground/80 hover:bg-muted sm:text-sm"
        >
          <Icon className={cn("size-7", muted ? "text-terracotta/50" : "text-terracotta")} strokeWidth={2} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="text-2xl font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

// A ticket: a stub on the left, a perforated edge, and one action on the right.
export function TicketCard({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  subtitle: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="relative flex items-stretch rounded-3xl bg-card shadow-[0_4px_20px_-6px_rgb(60_30_20/0.18)] ring-1 ring-foreground/5">
      <div className="flex min-w-0 flex-1 items-center gap-3 p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#e9a07f] to-[#b44f30] text-white shadow-inner">
          <Icon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="line-clamp-2 text-base leading-snug font-semibold sm:text-lg">{title}</p>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="relative flex w-24 shrink-0 items-center justify-center border-l-2 border-dashed border-border sm:w-32">
        <span aria-hidden className="absolute -top-3 -left-3 size-6 rounded-full bg-background shadow-[inset_0_-2px_3px_rgb(60_30_20/0.12)]" />
        <span aria-hidden className="absolute -bottom-3 -left-3 size-6 rounded-full bg-background shadow-[inset_0_2px_3px_rgb(60_30_20/0.12)]" />
        {action}
      </div>
    </div>
  );
}

// A link styled as the outlined pill the ticket and deal cards use.
export const pillLinkClass =
  "inline-flex h-10 items-center justify-center rounded-full border-2 border-terracotta/70 px-5 text-sm font-semibold text-terracotta-deep hover:bg-terracotta-soft";
