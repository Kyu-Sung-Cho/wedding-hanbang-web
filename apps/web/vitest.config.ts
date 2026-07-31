import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // PGlite boots a PostgreSQL WASM runtime per migration test file. Bounding
    // file workers prevents CPU/memory contention from turning healthy 5s
    // assertions into nondeterministic CI timeouts.
    maxWorkers: 4,
    testTimeout: 15_000,
    setupFiles: ["./src/test/supabaseDestinationEnv.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
