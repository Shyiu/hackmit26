"use client";

import type { UpdateCaregiverPreferences } from "@memory-glasses/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { playAlertTone } from "@/lib/tones";
import { FormMessage, SwitchRow } from "./field";

export type CaregiverPreferences = Required<UpdateCaregiverPreferences>;

// The caregiver's own preferences, saved as soon as a switch flips. They follow
// the account, so they sit apart from the wearer settings form and its save button.
export function AccountPreferencesForm({ initial }: { initial: CaregiverPreferences }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: UpdateCaregiverPreferences) {
    const previous = values;
    setValues((current) => ({ ...current, ...patch }));
    setPending(true);
    setError(null);
    try {
      const saved = await apiFetch<{ preferences: CaregiverPreferences }>("/api/account/preferences", {
        method: "PATCH",
        json: patch,
      });
      setValues(saved.preferences);
      router.refresh();
    } catch (err) {
      setValues(previous);
      setError(err instanceof Error ? err.message : "Saving failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-hairline p-3.5">
      <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your account</legend>
      <SwitchRow
        id="sound-notifications"
        label="Sound for new notifications"
        hint="Off by default. Plays a short tone on this dashboard when a new alert comes in. Saved for your account, on every device you sign in on."
        checked={values.soundNotificationsEnabled}
        disabled={pending}
        onCheckedChange={(checked) => {
          if (checked) playAlertTone(new AudioContext());
          void save({ soundNotificationsEnabled: checked });
        }}
      />
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </fieldset>
  );
}
