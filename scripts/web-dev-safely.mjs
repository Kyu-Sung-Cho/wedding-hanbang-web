import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  DevServerDestinationError,
  assertDevServerDestination,
} from "./lib/dev-server-destination-guard.mjs";
import { acquireWeddingCodeResearchLock } from "./wedding-code-research-lock.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "../apps/web");
const nextCli = path.join(appRoot, "node_modules/next/dist/bin/next");

// 목적지 검사는 락보다 **먼저** 한다. 거부된 실행이 연구/빌드 락을 남기면
// 다음 dev 서버가 "락이 잡혀 있다"로 막혀 원인을 엉뚱한 데서 찾게 된다.
let banner;
try {
  ({ banner } = assertDevServerDestination({ appRoot, argv: process.argv.slice(2) }));
} catch (error) {
  if (!(error instanceof DevServerDestinationError)) throw error;
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

console.log(`\n${banner}\n`);

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
