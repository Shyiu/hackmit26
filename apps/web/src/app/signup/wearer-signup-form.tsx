"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/client/api";

const MIN_PASSWORD = 10;

// The wearer's own account. Signing up also signs this phone in, so the next
// step is the code that connects a caregiver, then the wear page.
export function WearerSignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("confirm")) {
      setError("The passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/auth/wearer-signup", {
        method: "POST",
        json: { wearerName: form.get("wearerName"), email: form.get("email"), password },
      });
      router.replace("/wearer-connect");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wearerName">Your name</Label>
        <Input id="wearerName" name="wearerName" autoComplete="name" maxLength={60} required />
        <p className="text-xs text-muted-foreground">What your caregiver sees on their dashboard.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
        <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
