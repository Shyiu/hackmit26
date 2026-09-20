import { cn } from "@/lib/utils";

const DOTS = ["bg-[#14286b]", "bg-[#2f5fd0]", "bg-[#7fa2ec]", "bg-[#bcd0f7]", "bg-[#f7d774]"];

// The Memoir wordmark: lowercase name over a row of colored dots.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-start leading-none", className)}>
      <span className="text-[1.6em] font-semibold tracking-tight text-brand-deep">Memoir</span>
      <span className="mt-[0.15em] flex gap-[0.2em]">
        {DOTS.map((dot) => (
          <span key={dot} className={cn("size-[0.45em] rounded-full", dot)} />
        ))}
      </span>
    </span>
  );
}

// A two-part chip, like a membership badge: a dark label and a soft value.
export function RoleChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex h-8 min-w-0 items-stretch overflow-hidden rounded-[0.5rem] text-sm font-semibold whitespace-nowrap">
      <span className="flex shrink-0 items-center bg-brand-deep px-2.5 text-white [clip-path:polygon(0_0,100%_0,88%_100%,0_100%)] pr-4">
        {label}
      </span>
      <span className="-ml-2 flex min-w-0 items-center truncate bg-butter-soft px-3 text-butter-deep">{value}</span>
    </span>
  );
}
