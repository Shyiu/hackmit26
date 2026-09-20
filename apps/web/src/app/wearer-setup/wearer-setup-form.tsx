"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/client/api";

type WearerSignupResponse = { patientId: string; code: string; expiresAt: string };

export function WearerSetupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ response: WearerSignupResponse; issuedAt: number } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const response = await apiFetch<WearerSignupResponse>("/api/auth/wearer-signup", {
        method: "POST",
        json: { wearerName: form.get("wearerName") },
      });
      setResult({ response, issuedAt: Date.now() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    const minutes = Math.max(
      1,
      Math.round((new Date(result.response.expiresAt).getTime() - result.issuedAt) / 60_000),
    );
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border p-6 text-center">
        <p className="text-sm text-muted-foreground">Give this code to a caregiver:</p>
        <p className="font-mono text-4xl font-semibold tracking-widest">{result.response.code}</p>
        <p className="text-xs text-muted-foreground">
          Expires in {minutes} minute{minutes === 1 ? "" : "s"}. They enter it under Settings on their
          dashboard.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wearerName">Wearer&rsquo;s name</Label>
        <Input id="wearerName" name="wearerName" placeholder="Mom, Grandpa Joe" maxLength={60} required />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Setting up…" : "Get a pairing code"}
      </Button>
    </form>
  );
}
