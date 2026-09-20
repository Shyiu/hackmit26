"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import { shrinkFormPhotos } from "@/lib/client/photo";
import type { EnrolledPerson } from "@/lib/server/perception";
import { Field, FormMessage } from "./field";

export function AddPersonForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body = new FormData(event.currentTarget);
      body.set("consent", consent ? "yes" : "no");
      await shrinkFormPhotos(body);
      await apiFetch("/api/people", { method: "POST", body });
      form.current?.reset();
      setConsent(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Adding the person failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="person-name" label="Name">
          <Input id="person-name" name="name" maxLength={60} required autoComplete="off" placeholder="Maria" />
        </Field>
        <Field id="person-relation" label="Relation">
          <Input id="person-relation" name="relation" maxLength={60} autoComplete="off" placeholder="daughter" />
        </Field>
      </div>
      <Field
        id="person-photos"
        label="Photos"
        hint="One to five photos. If several faces appear, the largest is used. Photos without a detected face are saved but cannot help recognize the person."
      >
        <Input id="person-photos" name="photos" type="file" accept="image/jpeg,image/png" multiple required />
      </Field>
      <label className="flex min-h-9 cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 size-4"
        />
        <span>This person agreed to be recognized by the camera.</span>
      </label>
      <Button type="submit" size="lg" disabled={pending || !consent} className="w-full sm:w-auto sm:self-start">
        {pending ? "Reading the photos..." : "Add person"}
      </Button>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </form>
  );
}

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return new Date(iso).toLocaleString();
}

function EditPersonForm({
  person,
  onSaved,
  onCancel,
}: {
  person: EnrolledPerson;
  onSaved: (updated: EnrolledPerson) => void;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body = new FormData(event.currentTarget);
      await shrinkFormPhotos(body);
      const updated = await apiFetch<EnrolledPerson>(`/api/people/${person.id}`, { method: "PATCH", body });
      onSaved({ ...person, ...updated });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Saving failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`edit-name-${person.id}`} label="Name">
          <Input
            id={`edit-name-${person.id}`}
            name="name"
            defaultValue={person.name}
            maxLength={60}
            required
            autoComplete="off"
          />
        </Field>
        <Field id={`edit-relation-${person.id}`} label="Relation">
          <Input
            id={`edit-relation-${person.id}`}
            name="relation"
            defaultValue={person.relation ?? ""}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
      </div>
      <Field id={`edit-photos-${person.id}`} label="Photos" hint="Add up to five more photos, 20 total">
        <Input id={`edit-photos-${person.id}`} name="photos" type="file" accept="image/jpeg,image/png" multiple />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </form>
  );
}

// Polls while the page is open, so streaming from the phone shows up here within a couple of seconds.
export function PeopleList({ initial }: { initial: EnrolledPerson[] }) {
  const [people, setPeople] = useState(initial);
  // Keep the server and first client render identical; polling supplies the client clock.
  const [now, setNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const body = await apiFetch<{ people: EnrolledPerson[] }>("/api/people");
        if (stopped) return;
        setPeople(body.people);
        setError(null);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Loading failed");
      }
      if (!stopped) setNow(Date.now());
    }
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [initial]);

  async function remove(person: EnrolledPerson) {
    try {
      await apiFetch(`/api/people/${person.id}`, { method: "DELETE" });
      setPeople((current) => current.filter((item) => item.id !== person.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Removing failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {people.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline p-6 text-center text-sm text-muted-foreground">
          Nobody enrolled yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
          {people.map((person) => {
            const fresh = now !== null && person.lastSeenAt !== null && now - new Date(person.lastSeenAt).getTime() < 10_000;
            return (
              <li key={person.id} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {person.name}
                      {person.relation && (
                        <span className="font-normal text-muted-foreground"> · {person.relation}</span>
                      )}
                    </span>
                    <span className={fresh ? "text-xs font-medium text-emerald-600" : "text-xs text-muted-foreground"}>
                      {person.lastSeenAt
                        ? `${fresh ? "In view" : "Seen"} ${now === null ? person.lastSeenAt : ago(person.lastSeenAt, now)}, match ${(person.lastMatchConfidence ?? 0).toFixed(2)}`
                        : "Not seen yet"}
                      {` · ${person.photos} photo${person.photos === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setEditingId((current) => (current === person.id ? null : person.id))}
                      aria-label={`Edit ${person.name}`}
                    >
                      Edit
                    </Button>
                    <Button variant="outline" onClick={() => void remove(person)} aria-label={`Remove ${person.name}`}>
                      Remove
                    </Button>
                  </div>
                </div>
                {editingId === person.id && (
                  <EditPersonForm
                    person={person}
                    onSaved={(updated) => {
                      setPeople((current) => current.map((item) => (item.id === updated.id ? updated : item)));
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
