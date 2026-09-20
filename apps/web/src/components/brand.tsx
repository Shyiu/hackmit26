import { cn } from "@/lib/utils";

const DOTS = ["bg-[#14286b]", "bg-[#2f5fd0]", "bg-[#7fa2ec]", "bg-[#bcd0f7]", "bg-[#f7d774]"];

// The Memoir wordmark: the name next to a stack of its colored dots, sized to
// sit in a 28px sidebar row.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 leading-none", className)}>
      <span className="grid grid-cols-2 gap-0.5">
        {DOTS.slice(0, 4).map((dot) => (
          <span key={dot} className={cn("size-1.5 rounded-[1px]", dot)} />
        ))}
      </span>
      <span className="text-sm font-semibold tracking-tight text-brand-deep">Memoir</span>
    </span>
  );
}

// A two-part chip, like a membership badge: a dark label and a soft value.
export function RoleChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex h-5 min-w-0 items-stretch overflow-hidden rounded-[0.3rem] text-xs font-medium whitespace-nowrap">
      <span className="flex shrink-0 items-center bg-brand-deep px-1.5 text-white">{label}</span>
      <span className="flex min-w-0 items-center truncate bg-butter-soft px-1.5 text-butter-deep">{value}</span>
    </span>
  );
}
