"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/client/api";

// Joins a second wearer this caregiver didn't create -- the pairing code comes
// from that wearer's own /wearer-setup page. POST /api/auth/attach-patient
// re-mints the session cookie on success, so a refresh already sees it.
export function AttachPatientForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const formElement = event.currentTarget;
    try {
      const form = new FormData(formElement);
      const attached = await apiFetch<{ patientId: string }>("/api/auth/attach-patient", {
        method: "POST",
        json: { code: form.get("code") },
      });
      await apiFetch("/api/auth/select-patient", { method: "POST", json: attached });
      formElement.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-hairline p-3.5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Connect another wearer</p>
        <p className="text-xs text-muted-foreground">
          Enter the 6-digit code shown on that wearer&rsquo;s setup device.
        </p>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="pairing-code" className="sr-only">
            Pairing code
          </Label>
          <Input
            id="pairing-code"
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            className="font-mono tracking-widest"
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
