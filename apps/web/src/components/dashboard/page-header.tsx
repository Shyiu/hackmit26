import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Linear's two-tier header: a title bar that sticks to the top of the panel
// (on phones the slim MobileHeader already holds that spot),
// and a thinner context row under it for the page's one-line explanation.
// Both are full-bleed and hairline-separated, so the body below can be padded
// on its own.
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
    <div className="z-20 bg-panel/85 backdrop-blur md:sticky md:top-0 md:rounded-t-lg">
      <div className="flex h-12 items-center gap-2 border-b border-hairline px-4 md:px-5">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h1>
        {action && <div className="ml-auto flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      {description && (
        <p className="flex min-h-8 items-center border-b border-hairline px-4 text-xs text-muted-foreground md:px-5">
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
