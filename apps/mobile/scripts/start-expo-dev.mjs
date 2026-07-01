import { spawn } from "node:child_process";
import process from "node:process";

const expoCommand = process.platform === "win32" ? "expo.cmd" : "expo";
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const args = ["start", ...forwardedArgs];

const child = spawn(expoCommand, args, {
  env: {
    ...process.env,
    EXPO_NO_DEPENDENCY_VALIDATION: "1",
    EXPO_NO_TELEMETRY: "1",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});
