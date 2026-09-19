"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/client/api";
import { Field, FormMessage, SwitchRow } from "./field";

type SavedItem = { _id: string; updatedAt: string };

type Props =
  | { mode: "create" }
  | {
      mode: "edit";
      id: string;
      updatedAt: string;
      initial: { name: string; aliases: string[]; plural: boolean };
    };

function splitAliases(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

// Adds an item, or edits one. Edits carry the `updatedAt` the form loaded, so a
// save someone else made in the meantime gets a 409 instead of being overwritten.
export function ItemForm(props: Props) {
  const router = useRouter();
  const initial = props.mode === "edit" ? props.initial : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [aliases, setAliases] = useState(initial?.aliases.join(", ") ?? "");
  // Unset on a new item, so the server guesses from the name ("keys" is plural).
  const [plural, setPlural] = useState<boolean | null>(initial?.plural ?? null);
  const [loadedAt, setLoadedAt] = useState(props.mode === "edit" ? props.updatedAt : null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const body = {
      name: name.trim(),
      aliases: splitAliases(aliases),
      ...(plural !== null && { plural }),
    };
    try {
      if (props.mode === "create") {
        const item = await apiFetch<SavedItem>("/api/items", { method: "POST", json: body });
        router.push(`/dashboard/items/${item._id}`);
        router.refresh();
        return;
      }
      const item = await apiFetch<SavedItem>(`/api/items/${props.id}`, {
        method: "PATCH",
        json: { ...body, expectedUpdatedAt: loadedAt },
      });
      setLoadedAt(item.updatedAt);
      setMessage({ tone: "success", text: "Saved." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: describeError(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="item-name" label="Name" hint="The word the wearer uses, like “keys”.">
        <Input
          id="item-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={60}
          autoCapitalize="none"
          autoComplete="off"
        />
      </Field>
      <Field id="item-aliases" label="Other names" hint="Separate with commas: car keys, key ring.">
        <Input
          id="item-aliases"
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
          autoCapitalize="none"
          autoComplete="off"
        />
      </Field>
      <SwitchRow
        id="item-plural"
        label="Plural"
        hint={
          plural === null
            ? "Guessed from the name until you set it."
            : plural
              ? "Answers say “they were”."
              : "Answers say “it was”."
        }
        checked={plural ?? false}
        onCheckedChange={setPlural}
      />
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      <Button type="submit" size="lg" disabled={pending || name.trim() === ""} className="w-full sm:w-auto sm:self-start">
        {pending ? "Saving..." : props.mode === "create" ? "Add item" : "Save changes"}
      </Button>
    </form>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409 && error.message.startsWith("Someone else")) {
    return "Someone else saved this item first. Reload the page to see their changes, then try again.";
  }
  if (error instanceof ApiError && error.status === 409) {
    return `${error.message}. Pick another name, or archive the other item first.`;
  }
  return error instanceof Error ? error.message : "Saving failed";
}
