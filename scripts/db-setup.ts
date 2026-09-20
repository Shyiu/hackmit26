// Syncs the database to packages/db/src/registry.ts: collections, validators, and
// indexes. Safe to rerun; run it after pulling schema changes.
//
//   pnpm db:setup            collections, validators, indexes
//   pnpm db:setup --search   also Atlas Search and Vector Search indexes (optional after M3)
//   pnpm db:setup --prune    also drop indexes the registry doesn't declare
//   pnpm db:setup --if-configured   do nothing when MONGODB_URI is unset
//
// A hosted build runs it with --if-configured (the `vercel-build` script), so a
// deployment carries its collection validators with it. A validator left on the
// previous schema rejects every write of the new shape: signup answers 500.

import { syncDatabase } from "@memory-glasses/db";
import { intEnv, withDatabase } from "./lib/env";

const flags = new Set(process.argv.slice(2));

if (flags.has("--if-configured") && !process.env.MONGODB_URI) {
  console.log("MONGODB_URI is not set, skipping the schema sync.");
  process.exit(0);
}

const changes = await withDatabase((db) =>
  syncDatabase(db, {
    prune: flags.has("--prune"),
    search: flags.has("--search")
      ? {
          // README: text-embedding-3-small is 1536 wide unless you ask for fewer.
          textEmbeddingDimensions: intEnv("OPENAI_EMBEDDING_DIMENSIONS", 1536),
          roomEmbeddingDimensions: intEnv("ROOM_EMBEDDING_DIMENSIONS", 512),
        }
      : undefined,
  }),
);

if (changes.length === 0) {
  console.log("Already in sync.");
} else {
  for (const change of changes) {
    const name = change.name ? ` ${change.name}` : "";
    const detail = change.detail ? `  (${change.detail})` : "";
    console.log(`${change.collection.padEnd(18)} ${change.action}${name}${detail}`);
  }
}
if (changes.some((change) => change.action === "undeclared index")) {
  console.log("\nUndeclared indexes are left alone. Rerun with --prune to drop them.");
}
