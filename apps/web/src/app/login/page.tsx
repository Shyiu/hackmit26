import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

// Only same-origin paths, so ?next= can't bounce a signed-in caregiver off-site.
function safeNext(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) {
    redirect(next);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <LoginForm next={next} />
    </div>
  );
}
