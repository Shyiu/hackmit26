import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "./env";

// Keyframes, thumbnails, enrollment frames, and recording chunks live in one
// S3-compatible bucket (PLAN.md open decision 8). The sweep is the only script
// that writes to it, and it only deletes.

export function storageConfigured(): boolean {
  return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

let client: S3Client | undefined;

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "auto",
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

const DELETE_BATCH = 1000; // the S3 DeleteObjects limit

/** Deletes the keys; a key that's already gone is not an error. Throws if any deletion failed. */
export async function deleteObjects(keys: string[]): Promise<void> {
  const bucket = requireEnv("S3_BUCKET");
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    const batch = keys.slice(start, start + DELETE_BATCH);
    const result = await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const failed = (result.Errors ?? []).filter((error) => error.Code !== "NoSuchKey");
    if (failed.length > 0) {
      const first = failed[0];
      throw new Error(`${failed.length} object deletion(s) failed, e.g. ${first.Key}: ${first.Code} ${first.Message}`);
    }
  }
}
