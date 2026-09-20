"use client";

import type { UpdateSettings } from "@memory-glasses/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import { Field, FormMessage, SwitchRow } from "./field";

export type Settings = Required<UpdateSettings>;

const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm pointer-coarse:h-11 dark:bg-input/30";
const rangeClass = "h-11 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50";

function Group({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

// Every setting in one form with one save. The server merges and re-validates.
export function SettingsForm({ initial, timeZones }: { initial: Settings; timeZones: string[] }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [staleAfter, setStaleAfter] = useState(String(initial.staleAfterMinutes));
  const [retention, setRetention] = useState(String(initial.retentionDays));
  const [geofenceEnabled, setGeofenceEnabled] = useState(initial.geofence !== null);
  const [geofenceLat, setGeofenceLat] = useState(String(initial.geofence?.lat ?? 0));
  const [geofenceLng, setGeofenceLng] = useState(String(initial.geofence?.lng ?? 0));
  const [geofenceRadius, setGeofenceRadius] = useState(String(initial.geofence?.radiusMeters ?? 200));
  const [locationStaleAfter, setLocationStaleAfter] = useState(String(initial.locationStaleAfterMinutes));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const body: Settings = {
        ...values,
        voiceId: values.voiceId?.trim() || null,
        staleAfterMinutes: Number(staleAfter),
        retentionDays: Number(retention),
        locationStaleAfterMinutes: Number(locationStaleAfter),
        geofence: geofenceEnabled
          ? { lat: Number(geofenceLat), lng: Number(geofenceLng), radiusMeters: Number(geofenceRadius) }
          : null,
      };
      const saved = await apiFetch<{ settings: Settings }>("/api/settings", { method: "PATCH", json: body });
      setValues(saved.settings);
      setMessage({ tone: "success", text: "Saved. The wear page picks this up on its next check." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Saving failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Group title="Voice">
        <Field
          id="speaking-rate"
          label={
            <span className="flex w-full justify-between">
              <span>Speaking rate</span>
              <span className="tabular-nums text-muted-foreground">{values.speakingRate.toFixed(2)}×</span>
            </span>
          }
          hint="1.00 is the voice's normal pace. A little slower is easier to follow."
        >
          <input
            id="speaking-rate"
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={values.speakingRate}
            onChange={(event) => set("speakingRate", Number(event.target.value))}
            className={rangeClass}
          />
        </Field>
        <Field id="tts-provider" label="Voice provider">
          <select
            id="tts-provider"
            value={values.ttsProvider}
            onChange={(event) => set("ttsProvider", event.target.value as Settings["ttsProvider"])}
            className={selectClass}
          >
            <option value="elevenlabs">ElevenLabs</option>
            <option value="deepgram">Deepgram</option>
          </select>
        </Field>
        <Field id="voice-id" label="Voice ID" hint="Leave empty for the provider's default voice.">
          <Input
            id="voice-id"
            value={values.voiceId ?? ""}
            onChange={(event) => set("voiceId", event.target.value)}
            maxLength={100}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </Group>

      <Group title="Phone">
        <Field id="hud-level" label="Captions on the phone screen">
          <select
            id="hud-level"
            value={values.hudLevel}
            onChange={(event) => set("hudLevel", event.target.value as Settings["hudLevel"])}
            className={selectClass}
          >
            <option value="everything">Captions and status</option>
            <option value="captions">Captions only</option>
            <option value="off">Screen stays dark</option>
          </select>
        </Field>
        <SwitchRow
          id="recording-allowed"
          label="Allow recording"
          hint="Recordings stay on the phone."
          checked={values.recordingAllowed}
          onCheckedChange={(checked) => set("recordingAllowed", checked)}
        />
        <SwitchRow
          id="wake-word"
          label={
            <span className="flex items-center gap-2">
              Wake word <Badge variant="outline">Not built yet</Badge>
            </span>
          }
          hint="Saved now, used once wake word detection lands."
          checked={values.wakeWordEnabled}
          onCheckedChange={(checked) => set("wakeWordEnabled", checked)}
        />
        <Field
          id="wake-sensitivity"
          label={
            <span className="flex w-full justify-between">
              <span>Wake word sensitivity</span>
              <span className="tabular-nums text-muted-foreground">{Math.round(values.wakeWordSensitivity * 100)}%</span>
            </span>
          }
          hint="Not built yet."
        >
          <input
            id="wake-sensitivity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={values.wakeWordSensitivity}
            onChange={(event) => set("wakeWordSensitivity", Number(event.target.value))}
            className={rangeClass}
          />
        </Field>
      </Group>

      <Group title="Approved area">
        <SwitchRow
          id="geofence-enabled"
          label="Alert when the wearer leaves an area"
          hint="The wearer sees this area on the wear page."
          checked={geofenceEnabled}
          onCheckedChange={(checked) => {
            setGeofenceEnabled(checked);
            setMessage(null);
          }}
        />
        {geofenceEnabled && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="geofence-lat" label="Latitude">
              <Input
                id="geofence-lat"
                type="number"
                step="any"
                min={-90}
                max={90}
                value={geofenceLat}
                onChange={(event) => setGeofenceLat(event.target.value)}
                required
              />
            </Field>
            <Field id="geofence-lng" label="Longitude">
              <Input
                id="geofence-lng"
                type="number"
                step="any"
                min={-180}
                max={180}
                value={geofenceLng}
                onChange={(event) => setGeofenceLng(event.target.value)}
                required
              />
            </Field>
            <Field id="geofence-radius" label="Radius (m)">
              <Input
                id="geofence-radius"
                type="number"
                min={20}
                max={50000}
                step="any"
                value={geofenceRadius}
                onChange={(event) => setGeofenceRadius(event.target.value)}
                required
              />
            </Field>
          </div>
        )}
        {geofenceEnabled && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!("geolocation" in navigator)) {
                setMessage({ tone: "error", text: "Location is unavailable on this phone." });
                return;
              }
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  setGeofenceLat(String(position.coords.latitude));
                  setGeofenceLng(String(position.coords.longitude));
                  setMessage(null);
                },
                (error) => setMessage({ tone: "error", text: error.message || "Could not read your location." }),
                { enableHighAccuracy: false, timeout: 10_000 },
              );
            }}
          >
            Use my current location
          </Button>
        )}
        <Field id="location-stale-after" label="Alert when no location for (minutes)">
          <Input
            id="location-stale-after"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={locationStaleAfter}
            onChange={(event) => {
              setLocationStaleAfter(event.target.value);
              setMessage(null);
            }}
            required
          />
        </Field>
      </Group>

      <Group title="Answers and data">
        <Field
          id="stale-after"
          label="Call a sighting old after (minutes)"
          hint="Older sightings still get an answer, worded as an observation."
        >
          <Input
            id="stale-after"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={staleAfter}
            onChange={(event) => {
              setStaleAfter(event.target.value);
              setMessage(null);
            }}
            required
          />
        </Field>
        <Field id="retention" label="Keep history for (days)" hint="Sightings and questions older than this are deleted.">
          <Input
            id="retention"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            step={1}
            value={retention}
            onChange={(event) => {
              setRetention(event.target.value);
              setMessage(null);
            }}
            required
          />
        </Field>
        <Field id="timezone" label="Wearer's time zone" hint="So “this morning” means their morning.">
          <select
            id="timezone"
            value={values.timezone}
            onChange={(event) => set("timezone", event.target.value)}
            className={selectClass}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex flex-col gap-2 rounded-xl bg-background/95 py-2 backdrop-blur md:static md:bg-transparent md:p-0">
        {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
          {pending ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
