"use client";

import type { CameraChoice } from "@/hooks/use-camera";

// Every camera the browser lists. On a multi-lens iPhone each rear lens shows up
// separately; the ultra-wide lens is picked by default.
export function CameraSelect({
  cameras,
  activeDeviceId,
  onChange,
}: {
  cameras: MediaDeviceInfo[];
  activeDeviceId: string | undefined;
  onChange: (choice: CameraChoice) => void;
}) {
  if (cameras.length < 2) return null;

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>Camera</span>
      <select
        value={activeDeviceId ?? ""}
        onChange={(event) => {
          const camera = cameras.find((c) => c.deviceId === event.target.value);
          if (camera) onChange({ deviceId: camera.deviceId, label: camera.label });
        }}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {cameras.map((camera, index) => (
          <option key={camera.deviceId} value={camera.deviceId}>
            {camera.label || `Camera ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
