import { schemaPlan } from "./setup";

/**
 * The schema plan as JSON for other languages. A test fails when the committed
 * copy in generated/ falls behind the registry.
 */
export function renderSchemaExport(): string {
  const plan = schemaPlan();
  const exported = {
    comment: "Generated from packages/db/src/registry.ts by `pnpm --filter @memory-glasses/db export-schema`. Don't edit.",
    version: plan.version,
    fingerprint: plan.fingerprint,
    collections: Object.fromEntries(
      plan.collections.map((planned) => [
        planned.name,
        {
          validator: planned.validator,
          indexes: planned.indexes.map(({ purpose: _purpose, ...index }) => index),
        },
      ]),
    ),
  };
  return `${JSON.stringify(exported, null, 2)}\n`;
}
