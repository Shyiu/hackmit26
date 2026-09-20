"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch, storeDeviceToken } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export function PairForm({
  kind,
  next,
  className,
}: {
  kind: "headset" | "simulator";
  next: string;
  className?: string;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(kind === "headset" ? "Phone" : "Laptop");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await apiFetch<{ token: string }>("/api/devices/pair", {
        method: "POST",
        json: { code, name, kind },
      });
      storeDeviceToken(result.token);
      setPaired(true);
      window.setTimeout(() => setPaired(false), 2000);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Pairing failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <h2 className="font-medium">Pair this phone</h2>
        <p className="mt-1 text-sm opacity-70">
          On the dashboard, open Settings and tap “Pair a phone”, then enter the code here.
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          pattern={"\\d{6}"}
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="6-digit code"
          required
          aria-label="Pairing code"
        />
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder={kind === "headset" ? "Phone" : "Laptop"}
          required
          aria-label="Phone name"
        />
        <Button type="submit" size="lg" disabled={pending || code.length !== 6 || !name.trim()}>
          {pending ? "Pairing…" : paired ? "Paired" : "Pair"}
        </Button>
      </form>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <p className="text-xs opacity-60">
        Or a caregiver can{" "}
        <Link href={`/login?next=${next}`} className={buttonVariants({ variant: "link", size: "xs" })}>
          sign in
        </Link>{" "}
        on this phone (laptop dev).
      </p>
    </div>
  );
}
