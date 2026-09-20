"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { haversineMeters } from "@/lib/geofence";

export type LocationStatus = "off" | "unavailable" | "denied" | "waiting" | "inside" | "outside" | "no-fence";

export const LOCATION_LABELS: Record<LocationStatus, string> = {
  off: "off until capture resumes",
  unavailable: "unavailable on this phone",
  denied: "permission denied",
  waiting: "waiting for a fix",
  inside: "inside the approved area",
  outside: "OUTSIDE the approved area",
  "no-fence": "reporting, no approved area set",
};

export function useLocationReport({ enabled }: { enabled: boolean }): {
  status: LocationStatus;
  lastReportAt: number | null;
  error: string | null;
} {
  const [status, setStatus] = useState<LocationStatus>("waiting");
  const [lastReportAt, setLastReportAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastPosted = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const geolocationAvailable = typeof navigator !== "undefined" && "geolocation" in navigator;

  const onPosition = useEffectEvent((position: GeolocationPosition) => {
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    const previous = lastPosted.current;
    const now = Date.now();
    if (previous && now - previous.at < 30_000 && haversineMeters(previous, { lat, lng }) <= 50) return;
    lastPosted.current = { lat, lng, at: now };
    setError(null);
    void fetch("/api/location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        capturedAt: new Date(position.timestamp).toISOString(),
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Location report failed with ${response.status}`);
        return (await response.json()) as { inside: boolean | null };
      })
      .then((result) => {
        setStatus(result.inside === true ? "inside" : result.inside === false ? "outside" : "no-fence");
        setLastReportAt(Date.now());
      })
      .catch((reportError: unknown) => setError(reportError instanceof Error ? reportError.message : "Location report failed"));
  });

  const onError = useEffectEvent((geoError: GeolocationPositionError) => {
    setStatus(geoError.code === geoError.PERMISSION_DENIED ? "denied" : "unavailable");
    setError(geoError.message || null);
  });

  useEffect(() => {
    if (!enabled) return;
    if (!geolocationAvailable) {
      return;
    }
    const watch = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: false,
      maximumAge: 30_000,
      timeout: 60_000,
    });
    return () => navigator.geolocation.clearWatch(watch);
  }, [enabled, geolocationAvailable]);

  return {
    status: !enabled ? "off" : !geolocationAvailable ? "unavailable" : status,
    lastReportAt: enabled ? lastReportAt : null,
    error: enabled ? error : null,
  };
}
