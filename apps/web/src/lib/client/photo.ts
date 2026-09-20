// A phone's camera roll photo is several megabytes, and a hosted deployment rejects a
// request body over about 4.5 MB with a bare 413 before the route runs, so face photos
// are re-encoded here to fit the whole upload inside a budget. A face embedder doesn't
// need more than about 1600 pixels on the long edge.
const UPLOAD_BUDGET_BYTES = 3_500_000;
const EDGES = [1600, 1200, 900, 640];
const QUALITIES = [0.82, 0.7, 0.55];

/** The share of the budget one photo of this many gets. */
export function photoBudget(count: number, budget = UPLOAD_BUDGET_BYTES): number {
  return Math.floor(budget / Math.max(1, count));
}

async function toJpeg(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't resize the photo");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("This browser can't resize the photo");
  return blob;
}

/** The same photo as a JPEG under `budget` bytes, or the smallest this browser could make. */
export async function shrinkPhoto(photo: File, budget: number): Promise<File> {
  const bitmap = await createImageBitmap(photo);
  try {
    if (photo.size <= budget && Math.max(bitmap.width, bitmap.height) <= EDGES[0]) return photo;
    let smallest: Blob | null = null;
    for (const edge of EDGES) {
      for (const quality of QUALITIES) {
        const blob = await toJpeg(bitmap, edge, quality);
        if (smallest === null || blob.size < smallest.size) smallest = blob;
        if (blob.size <= budget) {
          return new File([blob], photo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
        }
      }
    }
    if (smallest === null) return photo;
    return new File([smallest], photo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/**
 * Replaces the `photos` entries of a form with versions small enough to upload.
 * Leaves the form alone when the browser has no canvas or the photos can't be decoded,
 * so a failure here is a normal upload attempt rather than a blocked one.
 */
export async function shrinkFormPhotos(body: FormData, field = "photos"): Promise<void> {
  const photos = body.getAll(field).filter((item): item is File => item instanceof File && item.size > 0);
  if (photos.length === 0) return;
  const budget = photoBudget(photos.length);
  let shrunk: File[];
  try {
    shrunk = await Promise.all(photos.map((photo) => shrinkPhoto(photo, budget)));
  } catch {
    return;
  }
  body.delete(field);
  for (const photo of shrunk) body.append(field, photo, photo.name);
}
