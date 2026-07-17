import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireWeddingCodeResearchLock } from "./wedding-code-research-lock.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "../apps/web");
const nextCli = path.join(appRoot, "node_modules/next/dist/bin/next");
const releaseLock = await acquireWeddingCodeResearchLock("standard-web-dev");

const child = spawn(process.execPath, [nextCli, "dev", ...process.argv.slice(2)], {
  cwd: appRoot,
  env: process.env,
  stdio: "inherit",
});

let finished = false;
async function finish(code = 1) {
  if (finished) return;
  finished = true;
  await releaseLock();
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", async (error) => {
  console.error(error);
  await finish(1);
});

child.on("exit", async (code) => {
  await finish(code ?? 1);
});
