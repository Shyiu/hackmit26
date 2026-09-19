import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";

// The frame around sign in and sign up: the wordmark, a title, the form, and
// a line linking to the other one.
export function AuthShell({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:justify-center">
      <div className="flex w-full max-w-sm flex-col gap-7">
        <Link href="/" aria-label="Memior home" className="self-start text-base">
          <Wordmark />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-3xl bg-card p-5 shadow-[0_4px_20px_-8px_rgb(60_30_20/0.18)] ring-1 ring-foreground/5">
          {children}
        </div>
        <p className="text-center text-sm text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}
