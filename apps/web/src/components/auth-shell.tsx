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
    <div className="flex min-h-dvh flex-col items-center bg-page px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:justify-center">
      <div className="flex w-full max-w-sm flex-col gap-5">
        <Link href="/" aria-label="Memoir home" className="self-start text-sm">
          <Wordmark />
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-lg border border-hairline bg-panel p-4 shadow-[0_1px_2px_rgb(20_45_120/0.06)]">
          {children}
        </div>
        <p className="text-center text-xs text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}
