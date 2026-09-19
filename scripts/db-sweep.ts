// Deletes records past their retention window, repairs item snapshots that
// pointed at them, and drops their objects from storage. Idempotent; a cron
// can run it as often as it likes.
//
//   pnpm db:sweep             delete
//   pnpm db:sweep --dry-run   report what would go, write nothing

import { sweepExpired } from "@memory-glasses/db";
import { deleteObjects, storageConfigured } from "./lib/storage";
import { withDatabase } from "./lib/env";

const dryRun = process.argv.includes("--dry-run");

if (!dryRun && !storageConfigured()) {
  console.warn("S3_* is not set; object keys are counted but nothing is deleted from storage.");
}

const report = await withDatabase((db) =>
  sweepExpired(db, {
    dryRun,
    log: (line) => console.log(line),
    deleteObjects: storageConfigured() ? deleteObjects : undefined,
  }),
);

if (Object.values(report.deleted).every((n) => !n) && report.clearedSnapshots === 0) {
  console.log("Nothing had expired.");
}
