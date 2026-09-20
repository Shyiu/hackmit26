"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const body: unknown = await response.json().catch(() => null);
    setPending(false);
    if (response.ok) {
      // A wearer's own account goes to their pages, not the dashboard `next` points at.
      const kind = typeof body === "object" && body !== null && "kind" in body ? body.kind : null;
      const destination =
        kind === "wearer" && typeof body === "object" && body !== null && "next" in body && typeof body.next === "string"
          ? body.next
          : next;
      router.replace(destination);
      router.refresh();
      return;
    }
    setError(
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "Sign in failed",
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
