import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every test file gets its own database on a real MongoDB, see test/helpers.ts.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
