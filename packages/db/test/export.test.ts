import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSchemaExport } from "../src/export";

describe("generated/mongo-schema.json", () => {
  it("matches the registry", () => {
    const committed = readFileSync(new URL("../generated/mongo-schema.json", import.meta.url), "utf8");
    expect(
      committed === renderSchemaExport(),
      "Out of date. Run `pnpm --filter @memory-glasses/db export-schema` and commit the result.",
    ).toBe(true);
  });
});
