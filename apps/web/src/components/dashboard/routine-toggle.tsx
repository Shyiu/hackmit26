"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api";

export function RoutineToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onCheckedChange(checked: boolean) {
    setPending(true);
    try {
      await apiFetch(`/api/routines/${id}`, { method: "PATCH", json: { active: checked } });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return <Switch aria-label={active ? "Deactivate routine" : "Activate routine"} checked={active} onCheckedChange={onCheckedChange} disabled={pending} />;
}
