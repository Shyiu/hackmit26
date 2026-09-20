"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
import { FormMessage } from "./field";

// Archiving keeps the item's history and frees its names; restoring brings it back.
export function ArchiveItemButton({ id, name, active }: { id: string; name: string; active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (active && !window.confirm(`Archive ${name}? The camera stops looking for it. Its history stays.`)) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/items/${id}`, { method: "PATCH", json: { active: !active } });
      if (active) router.push("/dashboard/items");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant={active ? "destructive" : "default"}
        disabled={pending}
        onClick={() => void toggle()}
        className="w-full sm:w-auto sm:self-start"
      >
        {pending ? "Saving..." : active ? "Archive item" : "Restore item"}
      </Button>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
