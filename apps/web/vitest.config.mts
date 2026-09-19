import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The routes import it to fail a client build; under vitest it just has to resolve.
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // The route tests run against a real MongoDB, see test/helpers.ts.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
