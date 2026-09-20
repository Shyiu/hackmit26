import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { safeNext } from "@/lib/safe-next";
import { SignupForm } from "./signup-form";
import { WearerSignupForm } from "./wearer-signup-form";

export const metadata: Metadata = { title: "Create an account" };

const COPY = {
  caregiver: {
    title: "Create a caregiver account",
    description: "One account per family. You'll add the things they misplace next.",
  },
  wearer: {
    title: "Create a wearer account",
    description: "Sign in on the phone you'll wear, then connect a caregiver with a code.",
  },
} as const;

function Tabs({ kind, next }: { kind: "caregiver" | "wearer"; next: string }) {
  const query = `next=${encodeURIComponent(next)}`;
  return (
    <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-page p-1 text-sm">
      {(["caregiver", "wearer"] as const).map((option) => (
        <Link
          key={option}
          href={`/signup?as=${option}&${query}`}
          aria-current={option === kind ? "page" : undefined}
          className={
            option === kind
              ? "rounded px-3 py-2 text-center font-semibold text-brand-deep shadow-[0_1px_2px_rgb(20_45_120/0.12)] bg-panel"
              : "rounded px-3 py-2 text-center text-muted-foreground"
          }
        >
          {option === "caregiver" ? "I'm a caregiver" : "I'm the wearer"}
        </Link>
      ))}
    </div>
  );
}

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next, as } = await searchParams;
  const target = safeNext(next);
  const kind = as === "wearer" ? "wearer" : "caregiver";
  return (
    <AuthShell
      title={COPY[kind].title}
      description={COPY[kind].description}
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(target)}`} className="font-semibold text-brand-deep">
            Sign in
          </Link>
        </>
      }
    >
      <Tabs kind={kind} next={target} />
      {kind === "wearer" ? <WearerSignupForm /> : <SignupForm next={target} />}
    </AuthShell>
  );
}
