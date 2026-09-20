import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TileTone = "brand" | "navy" | "sky" | "butter" | "ice" | "royal";

// Each tone is a soft tinted card with a rounded blob rising from the
// bottom-right corner, and the icon standing on it. Blues do the work; butter
// is the single warm accent.
const TONES: Record<TileTone, { card: string; blob: string; icon: string; ink?: string; fade?: string }> = {
  brand: { card: "bg-[#e4edff]", blob: "from-[#7fa2ec] to-[#2f5fd0]", icon: "text-white" },
  navy: { card: "bg-[#dde4f5]", blob: "from-[#4a68b8] to-[#14286b]", icon: "text-white" },
  sky: { card: "bg-[#e3f3fc]", blob: "from-[#9fd6f3] to-[#3d9ad1]", icon: "text-white" },
  butter: { card: "bg-[#fdf3c9]", blob: "from-[#fbe391] to-[#f0bf3a]", icon: "text-[#1b3a8f]" },
  royal: { card: "bg-[#a9c3f3]", blob: "from-[#7fa2ec] to-[#2f5fd0]", icon: "text-white", ink: "text-[#0f1b3d]", fade: "text-white/60" },
  ice: { card: "bg-[#f0f5fd]", blob: "from-[#c4d6f6] to-[#8fb0ea]", icon: "text-white" },
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
  size?: "large" | "small" | "wide" | "square";
  children?: ReactNode;
}) {
  const colors = TONES[tone];
  // Wide and square are the dashboard's flat buttons: a barely rounded corner,
  // a one-line title, and the icon large and faint behind it so every button
  // reads the same whatever the title's length.
  if (size === "wide" || size === "square") {
    const wide = size === "wide";
    return (
      <Link
        href={href}
        className={cn(
          "group relative flex min-w-0 items-center overflow-hidden rounded-[0.5rem] transition duration-200 active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
          wide ? "h-20 justify-start px-5" : "aspect-square justify-center px-1",
          colors.card,
        )}
      >
        <Icon
          aria-hidden
          strokeWidth={1.5}
          className={cn(
            "absolute",
            colors.fade ?? "text-white/70",
            wide ? "top-1/2 right-4 size-16 -translate-y-1/2" : "top-1/2 left-1/2 size-14 -translate-x-1/2 -translate-y-1/2",
          )}
        />
        <span
          className={cn(
            "relative z-10 font-semibold tracking-tight whitespace-nowrap",
            colors.ink ?? "text-foreground",
            wide ? "text-xl" : "text-[0.8rem]",
          )}
        >
          {title}
        </span>
      </Link>
    );
  }
  const large = size === "large";
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-w-0 overflow-hidden rounded-[1.75rem] p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-12px_rgb(20_45_120/0.35)] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none sm:p-5",
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
    <nav className="grid grid-cols-5 gap-1 rounded-3xl bg-card px-1 py-4 shadow-[0_4px_20px_-6px_rgb(20_45_120/0.15)] ring-1 ring-foreground/5">
      {shortcuts.map(({ href, label, icon: Icon, muted }) => (
        <Link
          key={href}
          href={href}
          className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1 text-center text-xs leading-tight font-medium text-foreground/80 hover:bg-muted sm:text-sm"
        >
          <Icon className={cn("size-7", muted ? "text-brand/50" : "text-brand")} strokeWidth={2} />
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
    <div className="relative flex items-stretch rounded-3xl bg-card shadow-[0_4px_20px_-6px_rgb(20_45_120/0.18)] ring-1 ring-foreground/5">
      <div className="flex min-w-0 flex-1 items-center gap-3 p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7fa2ec] to-[#1b3a8f] text-white shadow-inner">
          <Icon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="line-clamp-2 text-base leading-snug font-semibold sm:text-lg">{title}</p>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="relative flex w-24 shrink-0 items-center justify-center border-l-2 border-dashed border-border sm:w-32">
        <span aria-hidden className="absolute -top-3 -left-3 size-6 rounded-full bg-background shadow-[inset_0_-2px_3px_rgb(20_45_120/0.12)]" />
        <span aria-hidden className="absolute -bottom-3 -left-3 size-6 rounded-full bg-background shadow-[inset_0_2px_3px_rgb(20_45_120/0.12)]" />
        {action}
      </div>
    </div>
  );
}

// A link styled as the outlined pill the ticket and deal cards use.
export const pillLinkClass =
  "inline-flex h-10 items-center justify-center rounded-full bg-butter px-5 text-sm font-semibold text-[#3a2c00] transition-colors hover:bg-[#f2cb55]";
