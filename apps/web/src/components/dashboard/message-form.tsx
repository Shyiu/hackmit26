"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Field, FormMessage } from "./field";

const MAX_LENGTH = 200;
type Kind = "caregiver_message" | "reminder";

// Queues a message the wear page speaks at once, or a reminder it speaks at a set time.
export function MessageForm() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("caregiver_message");
  const [text, setText] = useState("");
  const [showAt, setShowAt] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiFetch("/api/notifications", {
        method: "POST",
        json: {
          kind,
          text: text.trim(),
          // datetime-local has no zone; the browser reads it as local time.
          ...(kind === "reminder" && { showAt: new Date(showAt).toISOString() }),
        },
      });
      setText("");
      setShowAt("");
      setMessage({ tone: "success", text: kind === "reminder" ? "Reminder set." : "Sent. The wear page will say it next." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Sending failed" });
    } finally {
      setPending(false);
    }
  }

  const trimmed = text.trim();
  const ready = trimmed.length > 0 && (kind === "caregiver_message" || showAt !== "");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["caregiver_message", "Say it now"],
            ["reminder", "Remind later"],
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

      <Field
        id="message-text"
        label="Message"
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
          id="message-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_LENGTH}
          rows={3}
          required
          placeholder={kind === "reminder" ? "Lunch is at noon." : "I'm on my way home."}
        />
      </Field>

      {kind === "reminder" && (
        <Field id="message-show-at" label="When">
          <Input
            id="message-show-at"
            type="datetime-local"
            value={showAt}
            onChange={(event) => setShowAt(event.target.value)}
            required
          />
        </Field>
      )}

      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      <Button type="submit" size="lg" disabled={pending || !ready} className="w-full sm:w-auto sm:self-start">
        {pending ? "Sending..." : kind === "reminder" ? "Set reminder" : "Send message"}
      </Button>
    </form>
  );
}
