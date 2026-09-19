import { LoginForm } from "./login-form";

// Only same-site paths, so a crafted link can't bounce a caregiver off-site after login.
function safeNext(next: string | string[] | undefined): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 pt-safe pb-safe">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Caregiver sign in</h1>
          <p className="text-muted-foreground">
            Sign in on the chest phone once, and the wear page uses the same session.
          </p>
        </div>
        <LoginForm next={safeNext(next)} />
      </div>
    </div>
  );
}
