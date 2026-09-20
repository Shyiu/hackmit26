// Syncs the database to packages/db/src/registry.ts: collections, validators, and
// indexes. Safe to rerun; run it after pulling schema changes.
//
//   pnpm db:setup            collections, validators, indexes
//   pnpm db:setup --search   also Atlas Search and Vector Search indexes (optional after M3)
//   pnpm db:setup --prune    also drop indexes the registry doesn't declare

import { syncDatabase } from "@memory-glasses/db";
import { intEnv, withDatabase } from "./lib/env";

const flags = new Set(process.argv.slice(2));

const { changes, migrations } = await withDatabase(async (db) => {
  const changes = await syncDatabase(db, {
    prune: flags.has("--prune"),
    search: flags.has("--search")
      ? {
          // README: text-embedding-3-small is 1536 wide unless you ask for fewer.
          textEmbeddingDimensions: intEnv("OPENAI_EMBEDDING_DIMENSIONS", 1536),
          roomEmbeddingDimensions: intEnv("ROOM_EMBEDDING_DIMENSIONS", 512),
        }
      : undefined,
  });
  const [devices, sightings, captureSessions, lastSighting, lastRestingSighting] = await Promise.all([
    db.collection("devices").updateMany({ kind: "headset" }, { $set: { kind: "chest" } }),
    db.collection("sightings").updateMany({ source: "headset" }, { $set: { source: "chest" } }),
    db.collection("capture_sessions").updateMany({ source: "headset" }, { $set: { source: "chest" } }),
    db
      .collection("items")
      .updateMany({ "lastSighting.source": "headset" }, { $set: { "lastSighting.source": "chest" } }),
    db.collection("items").updateMany(
      { "lastRestingSighting.source": "headset" },
      { $set: { "lastRestingSighting.source": "chest" } },
    ),
  ]);
  return {
    changes,
    migrations: [
      { collection: "devices", modifiedCount: devices.modifiedCount },
      { collection: "sightings", modifiedCount: sightings.modifiedCount },
      { collection: "capture_sessions", modifiedCount: captureSessions.modifiedCount },
      {
        collection: "items",
        modifiedCount: lastSighting.modifiedCount + lastRestingSighting.modifiedCount,
      },
    ],
  };
});

if (changes.length === 0) {
  console.log("Already in sync.");
} else {
  for (const change of changes) {
    const name = change.name ? ` ${change.name}` : "";
    const detail = change.detail ? `  (${change.detail})` : "";
    console.log(`${change.collection.padEnd(18)} ${change.action}${name}${detail}`);
  }
}
for (const migration of migrations) {
  if (migration.modifiedCount > 0) {
    console.log(
      `${migration.collection.padEnd(18)} migrated ${migration.modifiedCount} source "headset" -> "chest"`,
    );
  }
}
if (changes.some((change) => change.action === "undeclared index")) {
  console.log("\nUndeclared indexes are left alone. Rerun with --prune to drop them.");
}
