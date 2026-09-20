import { WearerSetupForm } from "./wearer-setup-form";

// Unauthenticated by design: this is the wearer's own first step, before any
// caregiver account exists to sign in as. See POST /api/auth/wearer-signup.
export default function WearerSetupPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Set up the wearer</h1>
        <p className="text-sm text-muted-foreground">
          Do this once on the wearer&rsquo;s own device. It gives you a code a caregiver enters to
          connect their account.
        </p>
      </div>
      <WearerSetupForm />
    </div>
  );
}
