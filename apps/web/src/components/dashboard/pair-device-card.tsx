"use client";

import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Field } from "./field";

type Device = {
  _id: string;
  kind: "headset" | "simulator" | "glasses";
  label: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type PairingCode = { code: string; expiresAt: string };

function kindLabel(kind: Device["kind"]) {
  return kind === "headset" ? "Chest phone" : kind === "simulator" ? "Simulator" : "Glasses";
}

function relativeTime(value: string | null) {
  if (!value) return "Never seen";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function PairDeviceCard({ initialDevices }: { initialDevices: Device[] }) {
  const [devices, setDevices] = useState(initialDevices);
  const [kind, setKind] = useState<"wear" | "sim">("wear");
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pairing) return;
    const update = () => setRemaining(Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  async function createCode() {
    setPending(true);
    setError(null);
    try {
      const next = await apiFetch<PairingCode>("/api/devices/pairing-codes", {
        method: "POST",
        json: { kind },
      });
      setPairing(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      const revoked = await apiFetch<Device>(`/api/devices/${id}/revoke`, { method: "POST" });
      setDevices((current) => current.map((device) => (device._id === id ? revoked : device)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
    }
  }

  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-hairline p-3.5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Pair a phone</p>
        <p className="text-xs text-muted-foreground">
          Generate a one-time code for the chest phone or simulator.
        </p>
      </div>
      <Field id="pair-device-kind" label="Phone type">
        <select
          id="pair-device-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as "wear" | "sim")}
          className="h-8 rounded-md border border-input bg-panel px-2.5 text-sm pointer-coarse:h-11"
        >
          <option value="wear">Chest phone (/wear)</option>
          <option value="sim">Simulator (/sim)</option>
        </select>
      </Field>
      <Button type="button" onClick={() => void createCode()} disabled={pending}>
        {pending ? "Generating…" : "Get pairing code"}
      </Button>
      {pairing && remaining > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
          <p className="font-mono text-3xl font-semibold tracking-[0.3em]">{pairing.code}</p>
          <p className="text-xs text-muted-foreground">
            Expires in {minutes}:{seconds.toString().padStart(2, "0")}
          </p>
          <p className="text-xs text-muted-foreground">
            On the phone, open {kind === "wear" ? "/wear" : "/sim"}, tap the screen for setup, and enter this code.
          </p>
        </div>
      )}
      {pairing && remaining === 0 && <p className="text-sm text-muted-foreground">This code has expired.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Paired phones</p>
        {devices.length === 0 ? (
          <p className="text-xs text-muted-foreground">No phones paired yet.</p>
        ) : (
          devices.map((device) => (
            <div
              key={device._id}
              className={`flex items-center justify-between gap-3 rounded-md border border-hairline px-2.5 py-2 text-sm ${
                device.revokedAt ? "text-muted-foreground opacity-60" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{device.label}</p>
                <p className="text-xs text-muted-foreground">
                  {kindLabel(device.kind)} · {device.revokedAt ? "Revoked" : relativeTime(device.lastSeenAt)}
                </p>
              </div>
              {!device.revokedAt && (
                <Button type="button" size="sm" variant="outline" onClick={() => void revoke(device._id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
