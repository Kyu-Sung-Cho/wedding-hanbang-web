import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // PGlite boots a PostgreSQL WASM runtime per migration test file. The web
    // suite now has dozens of those files, and four concurrent runtimes can
    // terminate a healthy Windows worker with exit 0xffffffff. Two workers kept
    // the exact full-suite release check stable without weakening assertions.
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
