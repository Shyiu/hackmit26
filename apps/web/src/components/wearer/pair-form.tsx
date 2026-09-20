"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PairForm({ defaultLabel }: { defaultLabel: string }) {
  const pathname = usePathname();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState(defaultLabel);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/devices/pair", { method: "POST", json: { code, label } });
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Input
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        placeholder="123456"
        aria-label="6-digit pairing code"
        className="font-mono tracking-widest"
        required
      />
      <Input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Phone label"
        aria-label="Phone label"
        maxLength={60}
        required
      />
      <Button type="submit" size="lg" disabled={pending || code.length !== 6 || !label.trim()}>
        {pending ? "Pairing…" : "Pair"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Or{" "}
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="underline underline-offset-2">
          sign in as a caregiver
        </Link>
      </p>
    </form>
  );
}
