import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { createMongoClient, DEFAULT_DB_NAME, type Db, type MongoClient } from "@memory-glasses/db";
import { requireEnv } from "./env";

declare global {
  // Kept on globalThis so hot reloads in dev reuse the pool instead of opening another.
  var __memoryGlassesMongo: MongoClient | undefined;
}

/** One connection pool per process. The driver connects on first use. */
export function getDb(): Db {
  let client = globalThis.__memoryGlassesMongo;
  if (!client) {
    client = createMongoClient(requireEnv("MONGODB_URI"));
    // On Vercel, closes idle pool connections before a function instance suspends.
    attachDatabasePool(client);
    globalThis.__memoryGlassesMongo = client;
  }
  return client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
}
