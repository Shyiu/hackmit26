import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMongoClient, DEFAULT_DB_NAME, type Db, type MongoClient } from "@memory-glasses/db";

// Scripts read the web app's env file, so MONGODB_URI lives in one place.
// Variables already set in the shell win over the file.
const webEnv = fileURLToPath(new URL("../../apps/web/.env.local", import.meta.url));
if (existsSync(webEnv)) process.loadEnvFile(webEnv);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Put it in apps/web/.env.local (see apps/web/.env.example).`);
  }
  return value;
}

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

/** Runs `task` against the configured database and always closes the connection. */
export async function withDatabase<T>(task: (db: Db, client: MongoClient) => Promise<T>): Promise<T> {
  const client = createMongoClient(requireEnv("MONGODB_URI"));
  await client.connect();
  try {
    return await task(client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME), client);
  } finally {
    await client.close();
  }
}
