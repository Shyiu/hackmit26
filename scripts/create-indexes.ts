import { MongoClient } from "mongodb";

// Creates the indexes listed in README.md "Data model" > "Indexes".
// Vector search indexes need an Atlas cluster (M10+ recommended); they're skipped
// with a warning if the cluster doesn't support createSearchIndex. They're also
// optional post-MVP per the README, not required for the fast path.
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "memory_glasses");

  await db.collection("items").createIndex({ patientId: 1, name: 1 });
  console.log("items: { patientId: 1, name: 1 }");

  await db.collection("sightings").createIndex({ patientId: 1, itemId: 1, lastSeenAt: -1 });
  console.log("sightings: { patientId: 1, itemId: 1, lastSeenAt: -1 }");

  await db.collection("sightings").createIndex(
    { patientId: 1, eventId: 1 },
    { unique: true }
  );
  console.log("sightings: unique { patientId: 1, eventId: 1 }");

  await db.collection("interactions").createIndex({ patientId: 1, askedAt: -1 });
  console.log("interactions: { patientId: 1, askedAt: -1 }");

  await db.collection("interactions").createIndex(
    { patientId: 1, requestId: 1 },
    { unique: true }
  );
  console.log("interactions: unique { patientId: 1, requestId: 1 }");

  // expiresAt is a coordinated-retention safeguard, not the primary cleanup path.
  // A worker does the actual delete/recompute; this TTL index just catches what it misses.
  await db.collection("sightings").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("interactions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  console.log("sightings, interactions: TTL safeguard on expiresAt");

  try {
    await db.collection("sightings").createSearchIndex({
      name: "sentence_embedding_vector",
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "vector", path: "sentenceEmbedding", numDimensions: 1536, similarity: "cosine" },
          { type: "filter", path: "patientId" },
          { type: "filter", path: "itemId" },
        ],
      },
    });
    console.log("sightings: vector search index on sentenceEmbedding");

    await db.collection("room_refs").createSearchIndex({
      name: "room_embedding_vector",
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "vector", path: "embedding", numDimensions: 512, similarity: "cosine" },
          { type: "filter", path: "patientId" },
        ],
      },
    });
    console.log("room_refs: vector search index on embedding");
  } catch (err) {
    console.warn(
      "Skipped vector search indexes (needs an Atlas cluster that supports createSearchIndex; optional post-MVP anyway):",
      err instanceof Error ? err.message : err
    );
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
