import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromeExecutablePath } from "./resolve-chrome-executable.mjs";
import { weddingCodeResearchLockPath } from "./wedding-code-research-lock.mjs";
import { isAllowedWeddingCodeResearchRequest } from "./wedding-code-research-safety.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const devScript = path.join(scriptDirectory, "wedding-code-candidate6-dev.mjs");
const generatedRoute = path.join(
  repoRoot,
  "apps/web/src/app/internal/wedding-code-research/page.tsx"
);
const generatedRouteDirectory = path.dirname(generatedRoute);
const appPort = 3108;
const sinkPort = 3110;
const appOrigin = `http://127.0.0.1:${appPort}`;
const appUrl = `${appOrigin}/internal/wedding-code-research?form=A`;
const sinkOrigin = `http://127.0.0.1:${sinkPort}`;
const executablePath = resolveChromeExecutablePath();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForReady(child, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`research server exited ${child.exitCode}`);
    try {
      const response = await fetch(appUrl, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("research server did not become ready");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  if (child.connected) child.send("shutdown");
  else child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const sinkRequests = [];
const sink = http.createServer((request, response) => {
  sinkRequests.push(`${request.method} ${request.url}`);
  response.writeHead(204);
  response.end();
});
await new Promise((resolve, reject) => {
  sink.once("error", reject);
  sink.listen(sinkPort, "127.0.0.1", resolve);
});

const serverOutput = [];
const researchServer = spawn(process.execPath, [devScript], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NEXT_PUBLIC_POSTHOG_HOST: sinkOrigin,
    NEXT_PUBLIC_POSTHOG_KEY: "phc_deliberately_fake_candidate6_key",
    NEXT_PUBLIC_SENTRY_DSN: `http://public@127.0.0.1:${sinkPort}/1`,
    PORT: String(appPort),
    SENTRY_DSN: `http://public@127.0.0.1:${sinkPort}/1`,
  },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
researchServer.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
researchServer.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

let browser;
try {
  await waitForReady(researchServer);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  const browserRequests = [];
  page.on("request", (request) => browserRequests.push({
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
  }));

  const response = await page.goto(appUrl, { waitUntil: "networkidle" });
  assert(response?.status() === 200, "research route must load with fake telemetry env");
  await page.getByLabel("아니요, 둘이 정하기로 했어요").check();
  await page.getByRole("button", { name: "장면 시작하기" }).click();
  await page.locator('input[value^="bipolar-"], input[value^="impact-"]').first().locator("..").click();
  await page.waitForTimeout(750);

  const persistence = await page.evaluate(async () => ({
    cacheKeys: "caches" in window ? await window.caches.keys() : [],
    cookie: document.cookie,
    localStorageKeys: Object.keys(window.localStorage),
    sessionStorageKeys: Object.keys(window.sessionStorage),
  }));
  const unexpectedBrowserRequests = browserRequests.filter(
    (request) => !isAllowedWeddingCodeResearchRequest(request, appOrigin)
  );

  assert(sinkRequests.length === 0, `telemetry sink received ${sinkRequests.join(", ")}`);
  assert(
    unexpectedBrowserRequests.length === 0,
    `browser made disallowed requests: ${JSON.stringify(unexpectedBrowserRequests)}`
  );
  assert(
    persistence.cookie === "" &&
      persistence.localStorageKeys.length === 0 &&
      persistence.sessionStorageKeys.length === 0 &&
      persistence.cacheKeys.length === 0,
    `browser persistence detected: ${JSON.stringify(persistence)}`
  );
  await context.close();
} catch (error) {
  console.error(serverOutput.join(""));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopChild(researchServer);
  await new Promise((resolve) => sink.close(resolve));
}

assert(!(await pathExists(generatedRoute)), "generated route must be removed after QA");
assert(
  !(await pathExists(generatedRouteDirectory)),
  "generated route directory must be removed after QA"
);
assert(!(await pathExists(weddingCodeResearchLockPath)), "research lock must be released after QA");

console.log(
  JSON.stringify(
    {
      browserPersistence: 0,
      externalBrowserRequests: 0,
      inheritedTelemetrySinkRequests: sinkRequests.length,
      routeCleaned: true,
      routeDirectoryCleaned: true,
      lockReleased: true,
    },
    null,
    2
  )
);
