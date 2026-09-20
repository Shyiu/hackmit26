"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ApiError, apiFetch } from "@/lib/client/api";

type Patient = { id: string; displayName: string };

export function WearerSwitcher({ patients, selectedId }: { patients: Patient[]; selectedId: string | null }) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (patients.length === 0) return null;
  if (patients.length === 1) {
    return <p className="px-2 pt-2 text-xs text-muted-foreground">{patients[0].displayName}</p>;
  }

  async function selectPatient(patientId: string) {
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/auth/select-patient", { method: "POST", json: { patientId } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't switch wearers. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 px-2 pt-2">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Wearer
      </label>
      <select
        id={id}
        value={selectedId ?? patients[0].id}
        onChange={(event) => void selectPatient(event.target.value)}
        disabled={pending}
        className="h-8 rounded-md border border-input bg-panel px-2.5 text-sm"
      >
        {patients.map((patient) => (
          <option key={patient.id} value={patient.id}>
            {patient.displayName}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
