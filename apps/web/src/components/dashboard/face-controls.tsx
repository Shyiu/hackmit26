"use client";

import { Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import { Field, FormMessage } from "./field";

export function AddFaceForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The blob URL is made when a file is chosen and released when it's replaced or the form goes away.
  const previewUrl = useRef<string | null>(null);
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  function choose(file: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = file ? URL.createObjectURL(file) : null;
    setPreview(previewUrl.current);
    setPhoto(file);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo) return;
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("name", name.trim());
      body.set("relation", relation.trim());
      body.set("consent", String(consent));
      body.set("photo", photo);
      await apiFetch("/api/people", { method: "POST", body });
      setName("");
      setRelation("");
      setConsent(false);
      choose(null);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Adding the face failed");
    } finally {
      setPending(false);
    }
  }

  const ready = photo !== null && name.trim() !== "" && relation.trim() !== "" && consent;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-3xl bg-card p-4 shadow-[0_4px_20px_-8px_rgb(20_45_120/0.15)] ring-1 ring-foreground/5"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="relative flex size-32 shrink-0 items-center justify-center overflow-hidden self-center rounded-2xl border border-dashed bg-muted/60 text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={photo ? "Change photo" : "Upload a photo"}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, nothing to optimize
            <img src={preview} alt="Chosen photo" className="size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-sm">
              <Upload className="size-5" />
              Upload photo
            </span>
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
        <div className="flex flex-1 flex-col gap-3">
          <Field id="face-name" label="Name">
            <Input
              id="face-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              required
              autoComplete="off"
              placeholder="Maria"
            />
          </Field>
          <Field id="face-relation" label="Relation" hint="How they're related to the wearer, like daughter or aide.">
            <Input
              id="face-relation"
              value={relation}
              onChange={(event) => setRelation(event.target.value)}
              maxLength={60}
              required
              autoComplete="off"
              placeholder="daughter"
            />
          </Field>
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          This person agreed to be enrolled. Their photo stays on our own servers and is only compared against faces
          the wearer sees.
        </span>
      </label>
      <p className="text-sm text-muted-foreground">Use a clear JPEG with exactly one face in it.</p>
      <Button type="submit" size="lg" disabled={pending || !ready} className="w-full sm:w-auto sm:self-start">
        {pending ? "Adding..." : "Add face"}
      </Button>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </form>
  );
}

export function DeleteFaceButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove ${name}? Their photo and face data are deleted.`)) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/people/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Removing failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" size="icon" disabled={pending} onClick={() => void remove()} aria-label={`Remove ${name}`}>
        <Trash2 />
      </Button>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
