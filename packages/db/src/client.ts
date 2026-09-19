import { MongoClient, type MongoClientOptions } from "mongodb";

export const DEFAULT_DB_NAME = "memory_glasses";

/**
 * A client tuned for serverless functions on the Atlas free tier, which caps
 * connections at 500. Each warm function instance keeps a small pool and lets
 * idle connections go. Callers own the client and should create one per process.
 */
export function createMongoClient(uri: string, options: MongoClientOptions = {}): MongoClient {
  return new MongoClient(uri, {
    appName: "memory-glasses",
    maxPoolSize: 10,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 5_000,
    ...options,
  });
}
