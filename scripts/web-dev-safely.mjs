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
//
// 같은 검사가 next.config 의 devServerDestinationFence 에도 있다(`npx next dev` 직접
// 실행을 막기 위해). 여기서 한 번 더 하는 이유는 **락을 잡고 Next 를 띄우기 전에**
// 끊기 위해서다. 배너는 찍지 않는다 — 두 번 찍히고, 게다가 실제 포트를 아는 쪽은
// Next 가 PORT 를 확정한 뒤에 도는 펜스다.
try {
  assertDevServerDestination({ appRoot, argv: process.argv.slice(2) });
} catch (error) {
  if (!(error instanceof DevServerDestinationError)) throw error;
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

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
