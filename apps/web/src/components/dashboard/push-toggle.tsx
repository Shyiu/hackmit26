"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/client/api";
import { currentSubscription, pushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/client/push";
import { FormMessage } from "./field";

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "unconfigured" }
  | { kind: "blocked" }
  | { kind: "off" }
  | { kind: "on" };

// "Alerts on this device": subscribes this browser to danger and lost alerts
// over Web Push. The permission state comes from the browser, the VAPID state
// from GET /api/push/public-key, and whether we're subscribed from the worker.
export function PushToggle({ testable }: { testable: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<State> {
      if (!pushSupported()) return { kind: "unsupported" };
      const key = await fetch("/api/push/public-key");
      if (key.status === 503) return { kind: "unconfigured" };
      if (Notification.permission === "denied") return { kind: "blocked" };
      return (await currentSubscription()) ? { kind: "on" } : { kind: "off" };
    }
    load()
      .catch((): State => ({ kind: "off" }))
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<void>, success: string) {
    setPending(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "success", text: success });
    } catch (error) {
      if (Notification.permission === "denied") setState({ kind: "blocked" });
      const text =
        error instanceof ApiError && error.status === 503
          ? "Web Push isn't configured on the server."
          : error instanceof Error
            ? error.message
            : "Something went wrong";
      setMessage({ tone: "error", text });
    } finally {
      setPending(false);
    }
  }

  const enable = () =>
    run(async () => {
      await subscribeToPush();
      setState({ kind: "on" });
    }, "This device now gets danger and lost alerts.");

  const disable = () =>
    run(async () => {
      await unsubscribeFromPush();
      setState({ kind: "off" });
    }, "Alerts are off on this device.");

  const test = () =>
    run(async () => {
      const response = await fetch("/api/push/test", { method: "POST" });
      const report: { sent?: number; error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(response.status, report.error ?? `Request failed with ${response.status}`);
      if (!report.sent) throw new Error("No device accepted the test push. Enable alerts first.");
    }, "Test alert sent. It should show up in a moment.");

  const status = {
    loading: { badge: "Checking...", hint: "Looking at this browser's notification settings." },
    unsupported: { badge: "Unavailable", hint: "This browser can't receive Web Push. On iPhone, add the dashboard to the Home Screen first." },
    unconfigured: { badge: "Not configured", hint: "The server has no VAPID keys. Run `pnpm push:keys` and add them to apps/web/.env.local." },
    blocked: { badge: "Blocked", hint: "Notifications are blocked for this site. Allow them in the browser's site settings, then try again." },
    off: { badge: "Off", hint: "Danger and lost alerts only reach the dashboard on its next check." },
    on: { badge: "On", hint: "Danger and lost alerts open a notification on this device, even with the dashboard closed." },
  }[state.kind];

  const canToggle = state.kind === "on" || state.kind === "off";

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <legend className="px-1 text-sm font-semibold">Alerts on this device</legend>
      <div className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            Web Push <Badge variant={state.kind === "on" ? "default" : "outline"}>{status.badge}</Badge>
          </span>
          <span className="text-sm text-muted-foreground">{status.hint}</span>
        </span>
        <Button
          type="button"
          variant={state.kind === "on" ? "outline" : "default"}
          disabled={!canToggle || pending}
          onClick={() => void (state.kind === "on" ? disable() : enable())}
        >
          {pending ? "Working..." : state.kind === "on" ? "Turn off" : "Enable alerts"}
        </Button>
      </div>
      {testable && state.kind === "on" && (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void test()} className="self-start">
          Send a test alert
        </Button>
      )}
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
    </fieldset>
  );
}
