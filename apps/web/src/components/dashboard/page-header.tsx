import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CaptureBadge } from "./capture-badge";

// The one bar at the top of every page. On desktop it carries a second tier for
// the page's one-line explanation; on a phone that row is dropped and the camera
// state moves in beside the actions, so there's a single bar instead of two.
export function PageHeader({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 bg-panel/85 pt-safe backdrop-blur md:rounded-t-lg md:pt-0">
      <div className="flex h-12 items-center gap-2 border-b border-hairline px-4 md:px-5">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {action}
          {/* Desktop keeps this in the sidebar, where there's room for it. */}
          <CaptureBadge compact className="md:hidden" />
        </div>
      </div>
      {description && (
        <p className="hidden min-h-8 items-center border-b border-hairline px-4 text-xs text-muted-foreground md:flex md:px-5">
          {description}
        </p>
      )}
    </div>
  );
}

// The padded column under the header. `width` narrows the readable pages the
// way `max-w-xl` used to.
export function PageBody({
  children,
  width = "full",
  className,
}: {
  children: ReactNode;
  width?: "full" | "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 px-4 py-5 md:px-5",
        width === "sm" && "max-w-xl",
        width === "md" && "max-w-3xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
