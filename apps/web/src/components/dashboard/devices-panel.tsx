"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/client/api";
import type { DeviceView } from "@/lib/server/views";
import { relativeTime } from "@/lib/relative-time";
import { EmptyState, rowListClass } from "./section";

type PairingCode = { code: string; expiresAt: string };

function countdown(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function DevicesPanel({ initialDevices }: { initialDevices: DeviceView[] }) {
  const [devices, setDevices] = useState(initialDevices);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expired = pairing !== null && new Date(pairing.expiresAt).getTime() <= now;

  const refresh = useCallback(async () => {
    const result = await apiFetch<{ devices: DeviceView[] }>("/api/devices");
    setDevices(result.devices);
  }, []);

  const livePairing = pairing !== null && !expired;

  useEffect(() => {
    if (!livePairing) return;
    const timer = window.setInterval(() => {
      void refresh().catch((caught) => {
        setError(caught instanceof ApiError ? caught.message : "Could not refresh devices");
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [livePairing, refresh]);

  async function mintCode() {
    setPending(true);
    setError(null);
    try {
      setPairing(await apiFetch<PairingCode>("/api/devices/pairing-codes", { method: "POST" }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create a pairing code");
    } finally {
      setPending(false);
    }
  }

  async function revoke(device: DeviceView) {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/devices/${device._id}/revoke`, { method: "POST" });
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not revoke the device");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {pairing && !expired ? (
          <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-4">
            <p className="font-mono text-4xl font-semibold tabular-nums tracking-[0.25em]">{pairing.code}</p>
            <p className="text-sm text-muted-foreground">Expires in {countdown(pairing.expiresAt, now)}</p>
            <p className="text-sm text-muted-foreground">
              On the phone open /wear (or /sim), tap the screen for setup, and enter this code. It works once.
            </p>
          </div>
        ) : (
          <>
            {pairing && <p className="text-sm text-muted-foreground">Code expired</p>}
            <Button onClick={() => void mintCode()} disabled={pending} className="self-start">
              Pair a phone
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {devices.length === 0 ? (
        <EmptyState>No phones paired yet.</EmptyState>
      ) : (
        <ul className={rowListClass}>
          {devices.map((device) => {
            const revoked = device.revokedAt !== null;
            return (
              <li key={device._id} className="flex items-center justify-between gap-4 px-2 py-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{device.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {device.kind} · paired {relativeTime(new Date(device.createdAt), new Date())} (
                    {new Date(device.createdAt).toLocaleString()})
                  </span>
                  <span className={`text-sm ${revoked ? "text-muted-foreground" : "text-emerald-600"}`}>
                    {revoked && device.revokedAt
                      ? `revoked ${new Date(device.revokedAt).toLocaleString()}`
                      : "active"}
                  </span>
                </div>
                {!revoked && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() => void revoke(device)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
