// Deletes records past their retention window and repairs item snapshots that
// pointed at them. Idempotent; a cron can run it as often as it likes.
//
//   pnpm db:sweep

import { sweepExpired } from "@memory-glasses/db";
import { withDatabase } from "./lib/env";

// TODO: pass deleteObjects once keyframes go to object storage (README open decision 8).
const report = await withDatabase((db) => sweepExpired(db));

const deleted = Object.entries(report.deleted).filter(([, count]) => count > 0);
console.log(
  deleted.length === 0
    ? "Nothing had expired."
    : deleted.map(([collection, count]) => `${collection}: ${count} deleted`).join("\n"),
);
console.log(`item snapshots cleared: ${report.clearedSnapshots}`);
if (report.objectKeys > 0) {
  console.log(`${report.objectKeys} object keys are orphaned; storage deletion isn't wired up yet`);
}
