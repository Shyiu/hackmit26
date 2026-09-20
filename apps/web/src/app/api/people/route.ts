import { HttpError, withTenant } from "@/lib/server/api";
import { listPeople, perceptionFetch, personView } from "@/lib/server/perception";

// Face enrollment. The photos and embeddings live in the perception service, which
// matches a wearer's frames against that wearer's own people and nobody else's.
export const GET = withTenant("caregiver", async ({ principal }) => {
  return Response.json({ people: await listPeople(principal.patientId) });
});

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 12_000_000;

export const POST = withTenant("caregiver", async ({ request, principal }) => {
  if (principal.kind !== "caregiver") throw new HttpError(403, "Only a caregiver can do this");
  const form = await request.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Send the photos as a form");
  const name = String(form.get("name") ?? "").trim();
  const relation = String(form.get("relation") ?? "").trim();
  const photos = form.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
  if (!name || name.length > 60) throw new HttpError(422, "Give a name of up to 60 characters");
  if (relation.length > 60) throw new HttpError(422, "Keep the relation under 60 characters");
  if (form.get("consent") !== "yes") throw new HttpError(422, "This person has to agree to being recognized first");
  if (photos.length === 0 || photos.length > MAX_PHOTOS) throw new HttpError(422, `Add one to ${MAX_PHOTOS} photos`);
  if (photos.some((photo) => photo.size > MAX_PHOTO_BYTES)) throw new HttpError(422, "Each photo must be under 12 MB");

  const upstream = new FormData();
  upstream.set("name", name);
  if (relation) upstream.set("relation", relation);
  // Who recorded the consent, never a value the form chose.
  upstream.set("consentedBy", principal.caregiverId.toHexString());
  for (const photo of photos) upstream.append("photos", photo, photo.name);

  const response = await perceptionFetch(principal.patientId, "/people", { method: "POST", body: upstream });
  return Response.json(personView(await response.json()), { status: 201 });
});
