"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
import { FormMessage } from "./field";

// Marks an open hazard as seen by the caregiver. The page refreshes to show the
// new status; a second click on a stale row surfaces the server's 409 message.
export function AcknowledgeAlertButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/danger-events/${id}/acknowledged`, { method: "POST" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" disabled={pending} onClick={() => void acknowledge()}>
        {pending ? "Saving..." : "Acknowledge"}
      </Button>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
