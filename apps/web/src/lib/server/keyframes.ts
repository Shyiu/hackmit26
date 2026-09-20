import "server-only";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GridFSBucket } from "mongodb";
import { Readable } from "node:stream";
import { getDb } from "./db";
import { HttpError } from "./api";
import { optionalEnv } from "./env";

export async function keyframeResponse(key: string): Promise<Response> {
  const endpoint = optionalEnv("S3_ENDPOINT");
  const bucket = optionalEnv("S3_BUCKET");
  const accessKeyId = optionalEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = optionalEnv("S3_SECRET_ACCESS_KEY");
  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    const client = new S3Client({
      endpoint,
      region: optionalEnv("S3_REGION") || "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 300,
    });
    return Response.redirect(url, 302);
  }

  const bucketStore = new GridFSBucket(await getDb(), { bucketName: "keyframes" });
  const exists = await bucketStore.find({ filename: key }).limit(1).hasNext();
  if (!exists) throw new HttpError(404, "Not found");
  const stream = bucketStore.openDownloadStreamByName(key);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
