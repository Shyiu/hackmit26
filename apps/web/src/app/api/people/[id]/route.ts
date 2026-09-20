import type { PersonId, PublicPerson } from "@memory-glasses/db";
import { updatePersonSchema, type UpdatePerson } from "@memory-glasses/shared";
import { HttpError, readBody, readId, withTenant } from "@/lib/server/api";
import { perceptionFetch, personFromUpstream, personView } from "@/lib/server/perception";

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 12_000_000;

// Name and relation live in Mongo and change there; perception rebuilds its gallery
// within face_gallery_ttl_s. New photos need perception's embedder, so they still go there.
export const PATCH = withTenant<{ id: string }>("caregiver", async ({ request, params, principal, tenant }) => {
  if (principal.kind !== "caregiver") throw new HttpError(403, "Only a caregiver can do this");
  const id = readId<PersonId>(params.id);

  let fields: UpdatePerson = {};
  let photos: File[] = [];
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) throw new HttpError(400, "Send the update as a form");
    const name = form.get("name");
    if (name !== null && String(name).trim()) fields.name = String(name).trim();
    if (fields.name && fields.name.length > 60) throw new HttpError(422, "Give a name of up to 60 characters");
    const relation = form.get("relation");
    if (relation !== null) fields.relation = String(relation).trim() || null;
    if (fields.relation && fields.relation.length > 60) {
      throw new HttpError(422, "Keep the relation under 60 characters");
    }
    photos = form.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
    if (photos.length > MAX_PHOTOS) throw new HttpError(422, `Add one to ${MAX_PHOTOS} photos`);
    if (photos.some((photo) => photo.size > MAX_PHOTO_BYTES)) {
      throw new HttpError(422, "Each photo must be under 12 MB");
    }
    if (fields.name === undefined && fields.relation === undefined && photos.length === 0) {
      throw new HttpError(422, "Nothing to update");
    }
  } else {
    fields = await readBody(request, updatePersonSchema).catch((error) => {
      if (error instanceof HttpError && error.status === 400) throw new HttpError(422, error.message);
      throw error;
    });
  }

  let person: PublicPerson | null = await tenant.people.update(id, fields);
  if (!person) throw new HttpError(404, "No such person");
  if (photos.length > 0) {
    const upstream = new FormData();
    for (const photo of photos) upstream.append("photos", photo, photo.name);
    const response = await perceptionFetch(principal.patientId, `/people/${id.toHexString()}/photos`, {
      method: "POST",
      body: upstream,
    });
    person = personFromUpstream(await response.json());
  }
  return Response.json(personView(person));
});

export const DELETE = withTenant<{ id: string }>("caregiver", async ({ params, tenant }) => {
  if (!(await tenant.people.remove(readId<PersonId>(params.id)))) throw new HttpError(404, "No such person");
  return new Response(null, { status: 204 });
});
