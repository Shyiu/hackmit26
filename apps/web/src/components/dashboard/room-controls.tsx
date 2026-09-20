"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import type { RoomView } from "@/lib/server/views";
import { Field, FormMessage, SwitchRow } from "./field";

const PRIVATE_HINT = "Private rooms are never described in answers.";

export function RoomForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch<RoomView>("/api/rooms", { method: "POST", json: { name: name.trim(), private: isPrivate } });
      setName("");
      setIsPrivate(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Adding the room failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field id="room-name" label="Name" hint="The word the family uses, like “the den” or “door”.">
        <Input
          id="room-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          required
          maxLength={60}
          autoCapitalize="none"
          autoComplete="off"
          placeholder="kitchen"
        />
      </Field>
      <SwitchRow id="room-private" label="Private" hint={PRIVATE_HINT} checked={isPrivate} onCheckedChange={setIsPrivate} />
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="submit" size="lg" disabled={pending || name.trim() === ""} className="w-full sm:w-auto sm:self-start">
        {pending ? "Adding..." : "Add room"}
      </Button>
    </form>
  );
}

export function RoomList({ initial }: { initial: RoomView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function patch(room: RoomView, changes: { name?: string; private?: boolean }) {
    setError(null);
    try {
      await apiFetch<RoomView>(`/api/rooms/${room._id}`, { method: "PATCH", json: changes });
      setEditingId(null);
      router.refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Saving failed");
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {initial.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No rooms yet. Add the rooms the wearer spends time in, and one called “door”.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
          {initial.map((room) => (
            <li key={room._id} className="flex flex-col gap-3 px-4 py-3">
              {editingId === room._id ? (
                <RenameForm room={room} onSave={(name) => patch(room, { name })} onCancel={() => setEditingId(null)} />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium capitalize">{room.name}</span>
                      {room.private && <Badge variant="secondary">Private</Badge>}
                    </span>
                    <span className="text-sm text-muted-foreground">Added {new Date(room.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" onClick={() => setEditingId(room._id)} aria-label={`Rename ${room.name}`}>
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void patch(room, { private: !room.private })}
                      aria-label={`${room.private ? "Make" : "Mark"} ${room.name} ${room.private ? "shared" : "private"}`}
                    >
                      {room.private ? "Make shared" : "Mark private"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RenameForm({
  room,
  onSave,
  onCancel,
}: {
  room: RoomView;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    await onSave(name.trim());
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        aria-label={`New name for ${room.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        maxLength={60}
        autoCapitalize="none"
        autoComplete="off"
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || name.trim() === ""}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
