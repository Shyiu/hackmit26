import "server-only";

// Server env vars, read when a route needs them rather than at import time, so
// a missing Deepgram key breaks speech and nothing else. apps/web/.env.example
// lists them all with where to get each one.
export type ServerEnvName =
  | "MONGODB_URI"
  | "MONGODB_DB"
  | "AUTH_SECRET"
  | "DEVICE_TOKEN_SECRET"
  | "CAREGIVER_EMAIL"
  | "CAREGIVER_PASSWORD"
  | "DEEPGRAM_API_KEY"
  | "DEEPGRAM_STT_MODEL"
  | "ELEVENLABS_API_KEY"
  | "OPENAI_API_KEY"
  | "NEXT_PUBLIC_PERCEPTION_WS_URL"
  | "PERCEPTION_URL"
  | "SPLAT_SLAM_URL"
  | "SPLAT_SLAM_KEY"
  | "SPLAT_SLAM_PREVIEW_TOKEN"
  | "S3_ENDPOINT"
  | "S3_BUCKET"
  | "S3_ACCESS_KEY_ID"
  | "S3_SECRET_ACCESS_KEY"
  | "S3_REGION";

export class MissingEnvError extends Error {
  override name = "MissingEnvError";
  constructor(readonly variable: ServerEnvName) {
    super(`${variable} is not set. Add it to apps/web/.env.local; apps/web/.env.example says where to get it.`);
  }
}

export function requireEnv(name: ServerEnvName): string {
  const value = process.env[name];
  if (!value) throw new MissingEnvError(name);
  return value;
}

export function optionalEnv(name: ServerEnvName): string | undefined {
  return process.env[name] || undefined;
}
