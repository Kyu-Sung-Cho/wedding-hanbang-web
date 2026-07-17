import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireWeddingCodeResearchLock } from "./wedding-code-research-lock.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "../apps/web");
const nextCli = path.join(webRoot, "node_modules/next/dist/bin/next");

function runNode(scriptOrCli, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptOrCli, ...args], {
      cwd: webRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptOrCli)} failed (${signal ?? code})`));
    });
  });
}

const releaseLock = await acquireWeddingCodeResearchLock("production-build");
try {
  await runNode(path.join(scriptDirectory, "check-amora-build-env.mjs"));
  await runNode(path.join(scriptDirectory, "check-wedding-code-research-route.mjs"));
  await runNode(nextCli, ["build"]);
  await runNode(path.join(scriptDirectory, "check-wedding-code-production-artifact.mjs"));
} finally {
  await releaseLock();
}
