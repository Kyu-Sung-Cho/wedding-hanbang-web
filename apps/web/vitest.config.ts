import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // PGlite boots a PostgreSQL WASM runtime per migration test file. Bounding
    // file workers prevents CPU/memory contention from turning healthy 5s
    // assertions into nondeterministic CI timeouts.
    maxWorkers: process.env.CI ? 2 : 4,
    // PGlite initialization can legitimately exceed Vitest's 10s hook
    // default on a shared CI runner even though the assertions remain fast.
    hookTimeout: 60_000,
    testTimeout: 15_000,
    setupFiles: ["./src/test/supabaseDestinationEnv.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/test/serverOnly.ts"),
    },
  },
});
