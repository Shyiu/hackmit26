import { HttpError, withTenant } from "@/lib/server/api";
import { perceptionError, perceptionFetch } from "@/lib/server/perception";
import { personView } from "@/lib/server/views";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Enrolled faces. Perception owns the writes, because it makes and stores the
// embeddings; this route lists from the database and forwards enrollment.
export const GET = withTenant("caregiver", async ({ tenant }) => {
  const people = await tenant.people.list();
  return Response.json({ people: people.map(personView) });
});

export const POST = withTenant("caregiver", async ({ request, principal }) => {
  const form = await request.formData().catch(() => null);
  if (!form) throw new HttpError(400, "The body must be a form");
  const name = String(form.get("name") ?? "").trim();
  const relation = String(form.get("relation") ?? "").trim();
  const photo = form.get("photo");
  if (!name || name.length > 60) throw new HttpError(400, "Enter a name of up to 60 characters");
  if (!relation || relation.length > 60) throw new HttpError(400, "Enter how they're related, up to 60 characters");
  if (form.get("consent") !== "true") throw new HttpError(400, "Confirm the person agreed to be enrolled");
  if (!(photo instanceof File) || photo.size === 0) throw new HttpError(400, "Choose a photo");
  if (photo.type !== "image/jpeg") throw new HttpError(400, "The photo must be a JPEG");
  if (photo.size > MAX_PHOTO_BYTES) throw new HttpError(400, "The photo is over 8 MB");

  const forward = new FormData();
  forward.set("name", name);
  forward.set("relation", relation);
  forward.set("consentedBy", `caregiver ${principal.kind === "caregiver" ? principal.caregiverId.toHexString() : ""}`.trim());
  forward.append("photos", photo, photo.name || "photo.jpg");
  const response = await perceptionFetch(principal.patientId, "/people", { method: "POST", body: forward });
  if (!response.ok) throw await perceptionError(response);
  return Response.json(await response.json(), { status: 201 });
});
