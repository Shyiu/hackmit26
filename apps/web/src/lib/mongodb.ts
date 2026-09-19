import { MongoClient } from "mongodb";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function createClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  const client = new MongoClient(uri);
  return client.connect();
}

// Reused across hot reloads in dev and across invocations in serverless prod
// so we don't open a new connection pool per request.
export const clientPromise: Promise<MongoClient> =
  globalThis._mongoClientPromise ??
  (globalThis._mongoClientPromise = createClientPromise());

export async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB ?? "memory_glasses");
}
