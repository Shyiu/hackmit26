// Writes generated/mongo-schema.json: every collection's validator and indexes,
// generated from src/registry.ts. The perception service's tests load it so its
// writes meet the same validators the real database enforces.
//
//   pnpm --filter @memory-glasses/db export-schema

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderSchemaExport } from "../src/export";

const target = fileURLToPath(new URL("../generated/mongo-schema.json", import.meta.url));
writeFileSync(target, renderSchemaExport());
console.log(`wrote ${target}`);
