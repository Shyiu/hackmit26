"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
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
        hint="One to five, each showing only this person. Add one taken from chest height, the angle the phone sees."
      >
        <Input id="person-photos" name="photos" type="file" accept="image/jpeg,image/png" multiple required />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
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

// Polls while the page is open, so streaming from the phone shows up here within a couple of seconds.
export function PeopleList({ initial }: { initial: EnrolledPerson[] }) {
  const [people, setPeople] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

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
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nobody enrolled yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
          {people.map((person) => {
            const fresh = person.lastSeenAt !== null && now - new Date(person.lastSeenAt).getTime() < 10_000;
            return (
              <li key={person.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {person.name}
                    {person.relation && <span className="font-normal text-muted-foreground"> · {person.relation}</span>}
                  </span>
                  <span className={fresh ? "text-sm font-medium text-emerald-600" : "text-sm text-muted-foreground"}>
                    {person.lastSeenAt
                      ? `${fresh ? "In view" : "Seen"} ${ago(person.lastSeenAt, now)}, match ${(person.lastMatchConfidence ?? 0).toFixed(2)}`
                      : "Not seen yet"}
                    {` · ${person.photos} photo${person.photos === 1 ? "" : "s"}`}
                  </span>
                </div>
                <Button variant="outline" onClick={() => void remove(person)} aria-label={`Remove ${person.name}`}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
