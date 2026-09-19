"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api";
import { Field, FormMessage } from "./field";

export function AddRoomForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/rooms", { method: "POST", json: { name: name.trim() } });
      setName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Adding the room failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field id="room-name" label="Room name">
            <Input
              id="room-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              required
              autoComplete="off"
              placeholder="the den"
            />
          </Field>
        </div>
        <Button type="submit" size="lg" disabled={pending || name.trim() === ""} className="w-full sm:w-auto">
          {pending ? "Adding..." : "Add room"}
        </Button>
      </div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </form>
  );
}

// Flips the private flag and shows the saved value once the server agrees.
export function RoomPrivateSwitch({ id, name, checked }: { id: string; name: string; checked: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/rooms/${id}`, { method: "PATCH", json: { private: next } });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Saving failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <span className="text-muted-foreground">Private</span>
        <Switch
          checked={checked}
          disabled={pending}
          onCheckedChange={(next) => void toggle(next)}
          aria-label={`Mark ${name} private`}
        />
      </label>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
