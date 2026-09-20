"use client";

import { useEffect, useState } from "react";
import { EmptyState, Section, listBlockClass } from "@/components/dashboard/section";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { StatusDot } from "@/components/dashboard/status-dot";
import { useItemStatuses } from "@/hooks/use-item-statuses";
import { whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

type CaptureState = "live" | "paused" | "offline";
type Capture = {
  state: CaptureState;
  source: string;
  startedAt: string;
  lastFrameAt: string | null;
  framesReceived: number;
  framesDropped: number;
} | null;

const CAPTURE_LABELS: Record<CaptureState, string> = {
  live: "Capturing",
  paused: "Paused",
  offline: "Offline",
};

const CAPTURE_DOTS: Record<CaptureState, string> = {
  live: "animate-pulse bg-emerald-500",
  paused: "bg-amber-500",
  offline: "bg-muted-foreground/50",
};

/** Polls /api/capture so this card matches the same capture session the CaptureBadge shows. */
function useCapture() {
  const [capture, setCapture] = useState<Capture>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/capture", { cache: "no-store" });
        if (cancelled) return;
        if (!response.ok) {
          setError(response.status === 401 ? "Sign in to see capture status." : `Couldn't load capture status (${response.status}).`);
          return;
        }
        const body = (await response.json()) as { capture: Capture };
        if (cancelled) return;
        setError(null);
        setCapture(body.capture);
        setCheckedAt(Date.now());
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { capture, checkedAt, error };
}

function CaptureStatusCard() {
  const { capture, checkedAt, error } = useCapture();
  const now = new Date();

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (checkedAt === null) return <p className="text-sm text-muted-foreground">Checking the phone&apos;s connection…</p>;
  if (!capture) {
    return <EmptyState>No device has ever opened the frame socket. Open /wear or /sim on the phone&apos;s browser.</EmptyState>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-panel p-3 sm:grid-cols-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">Status</span>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className={cn("size-2 rounded-full", CAPTURE_DOTS[capture.state])} />
          {CAPTURE_LABELS[capture.state]}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">Device</span>
        <span className="text-sm font-medium capitalize">{capture.source}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">Last frame</span>
        <span className="text-sm font-medium">
          {capture.lastFrameAt ? relativeTime(new Date(capture.lastFrameAt), now) : "None yet"}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">Frames</span>
        <span className="text-sm font-medium">
          {capture.framesReceived} received
          {capture.framesDropped > 0 && `, ${capture.framesDropped} dropped`}
        </span>
      </div>
    </div>
  );
}

function ItemStatusList() {
  const { items, error } = useItemStatuses();
  const now = new Date();

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!items) return <p className="text-sm text-muted-foreground">Loading items…</p>;
  if (items.length === 0) return <EmptyState>No active items. Add one from the Items tab first.</EmptyState>;

  return (
    <ul className={listBlockClass}>
      {items.map((item) => {
        const pending = item.lastSighting?.descriptionStatus === "pending";
        const failed = item.lastSighting?.descriptionStatus === "failed";
        return (
          <li key={item._id} className="flex flex-col gap-0.5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium capitalize">{item.name}</span>
              <StatusDot status={item.locationStatus} className="text-xs text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {pending
                ? "Confirmed — describing where it is…"
                : failed
                  ? "Confirmed, but the vision model couldn't describe it"
                  : whereLine(item.lastSighting)}
              {item.lastSighting && ` · ${relativeTime(new Date(item.lastSighting.lastSeenAt), now)}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What a caregiver checks to tell whether the system is actually working right
 * now: is the phone connected and sending frames, and is each tracked item's
 * last-known status current. No camera here -- that's the wearer's phone, not
 * this browser -- so this reads server state (/api/capture, /api/items)
 * instead of the raw detection overlay /sim shows on the phone itself.
 */
export function LiveDiagnostics() {
  return (
    <div className="flex flex-col gap-6">
      <Section title="What the wearer sees">
        <LiveFeed />
      </Section>
      <Section title="Phone connection">
        <CaptureStatusCard />
      </Section>
      <Section title="Item status">
        <ItemStatusList />
      </Section>
    </div>
  );
}
