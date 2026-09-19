import "server-only";
import { presign, type PresignedRequest, type S3Config } from "@memory-glasses/shared";
import { optionalEnv, requireEnv } from "./env";

// The keyframe and recording bucket, any S3-compatible store. Read per request,
// so a deployment without a bucket serves everything but uploads, and an upload
// route answers 503 through MissingEnvError rather than crashing.

export type Presigner = (input: { key: string; contentType: string }) => Promise<PresignedRequest>;

export function s3Config(): S3Config {
  return {
    endpoint: requireEnv("S3_ENDPOINT"),
    bucket: requireEnv("S3_BUCKET"),
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    region: optionalEnv("S3_REGION"),
  };
}

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** A signed PUT for one object, valid long enough for a slow phone on the chest. */
export const presignUpload: Presigner = ({ key, contentType }) =>
  presign(s3Config(), { method: "PUT", key, contentType, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
