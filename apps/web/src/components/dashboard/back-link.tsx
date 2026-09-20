import { ChevronLeft } from "lucide-react";
import Link from "next/link";

// Sits in the page header bar, ahead of the title, the way Linear puts the
// parent view at the head of a breadcrumb.
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md pr-1.5 pl-1 text-sm text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground"
    >
      <ChevronLeft className="size-3.5" />
      {label}
    </Link>
  );
}
