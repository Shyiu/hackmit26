"use client";

import { Download, Share } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { LocalRecording } from "@/hooks/use-recorder";

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function canShare(file: File) {
  return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}

async function share(file: File) {
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch {
    // The share sheet was dismissed.
  }
}

// Recordings made on this device since the page loaded. They live in memory, so
// save them before closing the page. Share opens the phone's share sheet, which
// on iPhone can save straight to Photos.
export function RecordingsList({ recordings }: { recordings: LocalRecording[] }) {
  if (recordings.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {recordings.map((recording) => (
        <li
          key={recording.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <span className="tabular-nums">
            {recording.startedAt.toLocaleTimeString()}, {formatDuration(recording.durationMs)},{" "}
            {(recording.file.size / 1_000_000).toFixed(1)} MB
          </span>
          <span className="flex gap-2">
            <a
              href={recording.url}
              download={recording.file.name}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <Download />
              Save
            </a>
            {canShare(recording.file) && (
              <Button size="sm" variant="outline" onClick={() => void share(recording.file)}>
                <Share />
                Share
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
