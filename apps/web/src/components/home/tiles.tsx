import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TileTone = "brand" | "navy" | "sky" | "butter" | "ice" | "royal";

// Each tone is a colored icon chip on an otherwise plain card. The blues do the
// work and butter is the single warm accent, same as before — but the color now
// lives in a 24px square instead of a gradient blob, so the cards sit quietly
// next to the lists on every other page.
const TONES: Record<TileTone, { chip: string; hover: string }> = {
  brand: { chip: "bg-[#2f5fd0] text-white", hover: "hover:border-[#2f5fd0]/40" },
  navy: { chip: "bg-[#14286b] text-white", hover: "hover:border-[#14286b]/40" },
  sky: { chip: "bg-[#3d9ad1] text-white", hover: "hover:border-[#3d9ad1]/40" },
  butter: { chip: "bg-[#f7d774] text-[#3a2c00]", hover: "hover:border-[#f0bf3a]/60" },
  royal: { chip: "bg-[#7fa2ec] text-white", hover: "hover:border-[#7fa2ec]/50" },
  ice: { chip: "bg-[#bcd0f7] text-[#14286b]", hover: "hover:border-[#8fb0ea]/50" },
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
  const { chip, hover } = TONES[tone];
  const base =
    "group flex min-w-0 items-center gap-2.5 rounded-lg border border-hairline bg-panel px-3 transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

  // Wide is the page's one full-width destination; square is a compact button.
  if (size === "wide") {
    return (
      <Link href={href} className={cn(base, hover, "h-12")}>
        <IconChip icon={Icon} className={chip} />
        <span className="text-sm font-semibold">{title}</span>
      </Link>
    );
  }
  if (size === "square") {
    return (
      <Link href={href} className={cn(base, hover, "h-16 flex-col justify-center gap-1.5 px-2")}>
        <IconChip icon={Icon} className={chip} />
        <span className="truncate text-xs font-medium">{title}</span>
      </Link>
    );
  }
  return (
    <Link href={href} className={cn(base, hover, "flex-col items-start justify-center gap-1.5 py-3")}>
      <IconChip icon={Icon} className={chip} />
      <span className="text-sm font-semibold">{title}</span>
      {children && <span className="text-xs text-muted-foreground">{children}</span>}
    </Link>
  );
}

function IconChip({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-[0.3rem]", className)}>
      <Icon className="size-3.5" strokeWidth={2} />
    </span>
  );
}

export type Shortcut = { href: string; label: string; icon: LucideIcon; muted?: boolean };

// A row of smaller destinations, as one bordered strip of cells.
export function ShortcutStrip({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <nav className="grid grid-cols-5 divide-x divide-hairline overflow-hidden rounded-lg border border-hairline">
      {shortcuts.map(({ href, label, icon: Icon, muted }) => (
        <Link
          key={href}
          href={href}
          className="flex h-14 flex-col items-center justify-center gap-1 px-1 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground sm:h-11 sm:flex-row sm:gap-1.5"
        >
          <Icon className={cn("size-3.5 shrink-0", muted ? "text-brand/50" : "text-brand")} />
          <span className="truncate">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
      {action}
    </div>
  );
}

// A row with an icon, two lines of text, and one action at the end.
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
    <div className="flex items-center gap-3 rounded-lg border border-hairline bg-panel px-3 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-white">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

// A link styled as the small accent button the ticket cards use.
export const pillLinkClass =
  "inline-flex h-6 items-center justify-center rounded-md bg-butter px-2.5 text-xs font-medium text-[#3a2c00] transition-colors hover:bg-[#f2cb55]";
