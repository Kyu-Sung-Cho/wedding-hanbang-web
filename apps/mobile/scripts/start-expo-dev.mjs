import { spawn } from "node:child_process";
import console from "node:console";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const requiredNodePrefix = "20.19.";
const portableWindowsNodeDirectory = "node-v20.19.6-win-x64";
const scriptPath = fileURLToPath(import.meta.url);

function normalizedExecutable(executable) {
  const resolved = path.resolve(executable);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function runChild(executable, args, env = process.env) {
  const child = spawn(executable, args, {
    env,
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (child.killed) {
        return;
      }

      try {
        child.kill(signal);
      } catch {
        child.kill();
      }
    });
  }

  child.once("error", (error) => {
    console.error(`Unable to start the Expo development process: ${error.message}`);
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

function findCompatibleNode() {
  const candidates = [
    process.env.HANBANG_MOBILE_NODE,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "hanbang-tools",
          portableWindowsNodeDirectory,
          "node.exe",
        )
      : null,
  ];

  const currentExecutable = normalizedExecutable(process.execPath);
  return candidates.find(
    (candidate) =>
      candidate &&
      existsSync(candidate) &&
      normalizedExecutable(candidate) !== currentExecutable,
  );
}

if (!process.versions.node.startsWith(requiredNodePrefix)) {
  const compatibleNode = findCompatibleNode();

  if (!compatibleNode) {
    console.error(
      [
        `Expo SDK 54 development requires Node ${requiredNodePrefix}x.`,
        `Current runtime: Node ${process.versions.node}.`,
        "Install Node 20.19.x or set HANBANG_MOBILE_NODE to its executable.",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Switching the mobile development server to Node ${requiredNodePrefix}x.`,
    );
    runChild(compatibleNode, [scriptPath, ...process.argv.slice(2)]);
  }
} else {
  const require = createRequire(import.meta.url);
  const expoCliPath = require.resolve("expo/bin/cli");
  const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--");
  const args = ["start", ...forwardedArgs];

  runChild(process.execPath, [expoCliPath, ...args], {
    ...process.env,
    EXPO_NO_DEPENDENCY_VALIDATION: "1",
    EXPO_NO_TELEMETRY: "1",
  });
}
