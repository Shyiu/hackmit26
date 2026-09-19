import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = safeNext(next);
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in on the chest phone once, and the wear page uses the same session."
      footer={
        <>
          New to Memior?{" "}
          <Link href={`/signup?next=${encodeURIComponent(target)}`} className="font-semibold text-terracotta-deep">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={target} />
    </AuthShell>
  );
}
