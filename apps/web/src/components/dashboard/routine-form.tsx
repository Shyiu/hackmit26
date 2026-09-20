"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/dashboard/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 200;
type TriggerKind = "time" | "leaving";

export function RoutineForm() {
  const router = useRouter();
  const [kind, setKind] = useState<TriggerKind>("time");
  const [name, setName] = useState("");
  const [at, setAt] = useState("");
  const [itemName, setItemName] = useState("");
  const [windowMinutes, setWindowMinutes] = useState("10");
  const [text, setText] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState("120");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiFetch("/api/routines", {
        method: "POST",
        json: {
          name: name.trim(),
          trigger:
            kind === "time"
              ? { kind: "time", at }
              : { kind: "leaving", itemName: itemName.trim(), windowMinutes: Number(windowMinutes) },
          text: text.trim(),
          cooldownMinutes: Number(cooldownMinutes),
          active: true,
        },
      });
      setName("");
      setAt("");
      setItemName("");
      setWindowMinutes("10");
      setText("");
      setCooldownMinutes("120");
      setMessage({ tone: "success", text: "Routine saved." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Saving failed" });
    } finally {
      setPending(false);
    }
  }

  const ready =
    name.trim().length > 0 &&
    text.trim().length > 0 &&
    (kind === "time" ? at !== "" : itemName.trim().length > 0 && Number(windowMinutes) > 0);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Trigger" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["time", "Time"],
            ["leaving", "Leaving the house"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              "min-h-11 rounded-md text-sm font-medium transition-colors",
              kind === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Field id="routine-name" label="Name">
        <Input id="routine-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </Field>

      {kind === "time" ? (
        <Field id="routine-time" label="Time">
          <Input id="routine-time" type="time" value={at} onChange={(event) => setAt(event.target.value)} required />
        </Field>
      ) : (
        <>
          <Field id="routine-item" label="Item to take">
            <Input id="routine-item" value={itemName} onChange={(event) => setItemName(event.target.value)} required />
          </Field>
          <Field id="routine-window" label="Window (minutes)">
            <Input
              id="routine-window"
              type="number"
              min={1}
              max={240}
              value={windowMinutes}
              onChange={(event) => setWindowMinutes(event.target.value)}
              required
            />
          </Field>
        </>
      )}

      <Field
        id="routine-text"
        label="What to say"
        hint={
          <span className="flex justify-between gap-3">
            <span>Short and calm. One idea at a time.</span>
            <span className={cn("tabular-nums", text.length > MAX_LENGTH - 20 && "text-foreground")}>
              {text.length}/{MAX_LENGTH}
            </span>
          </span>
        }
      >
        <Textarea
          id="routine-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_LENGTH}
          rows={3}
          required
          placeholder="Don't forget your medication."
        />
      </Field>

      <Field id="routine-cooldown" label="Cooldown (minutes)">
        <Input
          id="routine-cooldown"
          type="number"
          min={0}
          max={1440}
          value={cooldownMinutes}
          onChange={(event) => setCooldownMinutes(event.target.value)}
          required
        />
      </Field>

      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      <Button type="submit" size="lg" disabled={pending || !ready} className="w-full sm:w-auto sm:self-start">
        {pending ? "Saving..." : "Save routine"}
      </Button>
    </form>
  );
}
