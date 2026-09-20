// Syncs the database to packages/db/src/registry.ts: collections, validators, and
// indexes. Safe to rerun; run it after pulling schema changes.
//
//   pnpm db:setup            collections, validators, indexes
//   pnpm db:setup --search   also Atlas Search and Vector Search indexes (optional after M3)
//   pnpm db:setup --prune    also drop indexes the registry doesn't declare

import { syncDatabase } from "@memory-glasses/db";
import { intEnv, withDatabase } from "./lib/env";

const flags = new Set(process.argv.slice(2));

const changes = await withDatabase((db) =>
  syncDatabase(db, {
    prune: flags.has("--prune"),
    search: flags.has("--search")
      ? {
          // PLAN.md: text-embedding-3-small is 1536 wide unless you ask for fewer.
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
