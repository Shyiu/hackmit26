"use client";

import { useEffect, useState } from "react";
import { Bell, MessageSquare, UserRound, X, type LucideIcon } from "lucide-react";
import type { NotificationKind } from "@memory-glasses/shared";
import { holdTimeMs } from "@/hooks/use-hud-message";
import type { WearerNotice } from "@/hooks/use-wearer-client";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

const NOTICE_KINDS: Record<NotificationKind, { icon: LucideIcon; label: string; cardClass?: string }> = {
  caregiver_message: { icon: MessageSquare, label: "Message" },
  reminder: { icon: Bell, label: "Reminder" },
  person_recognized: { icon: UserRound, label: "Recognized" },
};

export function NoticeStack({
  notices,
  onDismiss,
  className,
}: {
  notices: WearerNotice[];
  onDismiss: (id: string) => void;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (notices.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [notices.length]);

  if (notices.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className={cn("pointer-events-auto flex flex-col gap-2", className)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {notices.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} now={now} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function NoticeCard({
  notice,
  now,
  onDismiss,
}: {
  notice: WearerNotice;
  now: number;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(notice.id), Math.max(8000, holdTimeMs(notice.text)));
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.kind, notice.text, onDismiss]);

  const detail = NOTICE_KINDS[notice.kind] ?? { icon: Bell, label: "Notice" };
  const Icon = detail.icon;

  return (
    <div className={cn("flex items-start gap-3 rounded-xl bg-black/70 px-4 py-3 text-white backdrop-blur", detail.cardClass)}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-wide text-white/70 uppercase">{detail.label}</p>
        <p className="text-sm font-medium">{notice.text}</p>
        <p className="text-xs text-white/60">{relativeTime(new Date(notice.at), new Date(now))}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onDismiss(notice.id)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
