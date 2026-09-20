"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/client/api";

const POLL_MS = 4000;

export function ConnectCaregiverPanel() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function issue() {
    setPending(true);
    setError(null);
    try {
      const issued = await apiFetch<{ code: string }>("/api/auth/caregiver-link", { method: "POST" });
      setCode(issued.code);
    } catch (err) {
      // A caregiver joined between the poll and this click: the code is moot now.
      if (err instanceof ApiError && err.status === 409) {
        router.replace("/wear");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ code: string }>("/api/auth/caregiver-link", { method: "POST" })
      .then((issued) => {
        if (!cancelled) setCode(issued.code);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 409) router.replace("/wear");
        else setError("Couldn't get a code. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // The caregiver redeems the code on their own device, so nothing here would
  // notice otherwise; the wear page is where the wearer belongs once they have.
  useEffect(() => {
    const timer = setInterval(() => {
      void apiFetch<{ linked: boolean }>("/api/auth/caregiver-link")
        .then((status) => {
          if (status.linked) router.replace("/wear");
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-hairline p-6 text-center">
      <p className="font-mono text-4xl font-semibold tracking-widest">{code ?? "······"}</p>
      <p className="text-xs text-muted-foreground">A code lasts ten minutes.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" variant="secondary" onClick={() => void issue()} disabled={pending}>
        {pending ? "Getting a code…" : "Get a new code"}
      </Button>
      <Link href="/wear" className="text-xs text-muted-foreground underline underline-offset-2">
        Skip for now and start wearing
      </Link>
    </div>
  );
}
