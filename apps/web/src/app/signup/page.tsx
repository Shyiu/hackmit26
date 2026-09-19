import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { safeNext } from "@/lib/safe-next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  const target = safeNext(next);
  return (
    <AuthShell
      title="Create an account"
      description="One account per family. You'll add the things they misplace next."
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(target)}`} className="font-semibold text-terracotta-deep">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm next={target} />
    </AuthShell>
  );
}
