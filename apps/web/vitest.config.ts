import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // PGlite boots a PostgreSQL WASM runtime per migration test file. Four
    // workers pass in isolation but have twice terminated the web test process
    // inside the cache-cleared merged release gate. Keep two workers so local,
    // pre-push, and CI checks share the release-proven stable bound.
    maxWorkers: 2,
    testTimeout: 15_000,
    setupFiles: ["./src/test/supabaseDestinationEnv.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
