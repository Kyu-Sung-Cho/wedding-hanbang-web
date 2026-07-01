import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const expoCliPath = require.resolve("@expo/cli/build/bin/cli");
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const args = ["start", ...forwardedArgs];

const child = spawn(process.execPath, [expoCliPath, ...args], {
  env: {
    ...process.env,
    EXPO_NO_DEPENDENCY_VALIDATION: "1",
    EXPO_NO_TELEMETRY: "1",
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});
