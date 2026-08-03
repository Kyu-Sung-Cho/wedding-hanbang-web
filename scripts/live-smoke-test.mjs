#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DEFAULT_BASE_URL = "https://hanbang.ai";
const DEFAULT_TIMEOUT_MS = 45_000;
const REPORT_ROOT = ".gstack/qa-reports/live-smoke";

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.LIVE_SMOKE_BASE_URL || DEFAULT_BASE_URL,
    browserPath: process.env.LIVE_SMOKE_BROWSER_PATH || "",
    headed: process.env.LIVE_SMOKE_HEADED === "1",
    json: false,
    skipDemo: process.env.LIVE_SMOKE_SKIP_DEMO === "1",
    timeoutMs: Number(process.env.LIVE_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };

  for (const arg of argv) {
    if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--browser-path=")) options.browserPath = arg.slice("--browser-path=".length);
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--skip-demo") options.skipDemo = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 5_000) {
    throw new Error("--timeout-ms must be a number greater than or equal to 5000");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm qa:live [options]

Options:
  --base-url=<url>       Target origin. Default: ${DEFAULT_BASE_URL}
  --browser-path=<path>  Chrome or Edge executable path.
  --timeout-ms=<ms>      Per-page timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --headed               Show the browser window.
  --skip-demo            Skip demo login flow.
  --json                 Print JSON result only.

Environment:
  LIVE_SMOKE_BASE_URL
  LIVE_SMOKE_BROWSER_PATH
  LIVE_SMOKE_TIMEOUT_MS
  LIVE_SMOKE_HEADED=1
  LIVE_SMOKE_SKIP_DEMO=1`);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findBrowserExecutable(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`Browser executable not found: ${explicitPath}`);
    }
    return explicitPath;
  }

  const platform = os.platform();
  const candidates = [];

  if (platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    );
    candidates.push(...commandOutput("where.exe", ["chrome.exe"]));
    candidates.push(...commandOutput("where.exe", ["msedge.exe"]));
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else {
    candidates.push(
      ...commandOutput("which", ["google-chrome"]),
      ...commandOutput("which", ["google-chrome-stable"]),
      ...commandOutput("which", ["chromium"]),
      ...commandOutput("which", ["chromium-browser"]),
      ...commandOutput("which", ["microsoft-edge"])
    );
  }

  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(
      "Chrome or Edge was not found. Install Chrome/Edge or set LIVE_SMOKE_BROWSER_PATH to the browser executable."
    );
  }
  return found;
}

function firstPartyOnly(baseUrl, responseUrl) {
  try {
    return new URL(responseUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function shouldIgnoreResponse(url) {
  return /\/favicon\.ico(?:\?|$)/.test(url);
}

function createCheckResult(name, url) {
  return {
    name,
    url,
    finalUrl: "",
    title: "",
    h1: "",
    status: null,
    ok: false,
    durationMs: 0,
    screenshot: "",
    failures: [],
    consoleErrors: [],
    pageErrors: [],
    badResponses: [],
  };
}

function addFailure(result, message) {
  result.failures.push(message);
  result.ok = false;
}

async function textOrEmpty(locator, timeout = 2_500) {
  return (await locator.textContent({ timeout }).catch(() => ""))?.trim() || "";
}

async function jsonBody(page, result, label) {
  const raw = await page.locator("body").innerText().catch(() => "");
  try {
    return JSON.parse(raw);
  } catch {
    addFailure(result, `Expected ${label} to return valid JSON`);
    return null;
  }
}

async function runPageCheck(browser, options, reportDir, check) {
  const context = await browser.newContext({
    viewport: check.viewport || { width: 1366, height: 900 },
    isMobile: Boolean(check.isMobile),
    hasTouch: Boolean(check.hasTouch),
    deviceScaleFactor: check.deviceScaleFactor || 1,
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();
  const result = createCheckResult(check.name, `${options.baseUrl}${check.path}`);
  const startedAt = Date.now();

  page.on("console", (message) => {
    if (message.type() === "error") {
      result.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    result.pageErrors.push(error.message);
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      firstPartyOnly(options.baseUrl, response.url()) &&
      !shouldIgnoreResponse(response.url())
    ) {
      result.badResponses.push({ status: response.status(), url: response.url() });
    }
  });

  try {
    const response = await page.goto(result.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);

    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title().catch(() => "");
    result.h1 = await textOrEmpty(page.locator("h1").first());

    if (!response || response.status() < 200 || response.status() >= 400) {
      addFailure(result, `Expected a 2xx/3xx page response, got ${response?.status() ?? "none"}`);
    }

    await check.assert(page, result, options);

    if (result.badResponses.length > 0) {
      addFailure(result, `${result.badResponses.length} first-party 4xx/5xx response(s)`);
    }
    if (result.consoleErrors.length > 0) {
      addFailure(result, `${result.consoleErrors.length} console error(s)`);
    }
    if (result.pageErrors.length > 0) {
      addFailure(result, `${result.pageErrors.length} uncaught page error(s)`);
    }

    const screenshotPath = path.join(reportDir, `${check.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    result.screenshot = screenshotPath;

    result.ok = result.failures.length === 0;
  } catch (error) {
    addFailure(result, error instanceof Error ? error.message : String(error));
  } finally {
    result.durationMs = Date.now() - startedAt;
    await context.close().catch(() => {});
  }

  return result;
}

function hasPath(url, expectedPath) {
  return new URL(url).pathname === expectedPath;
}

function hasPathEnding(url, expectedEnding) {
  return new URL(url).pathname.endsWith(expectedEnding);
}

function buildChecks(skipDemo) {
  const checks = [
    {
      name: "mobile-runtime-contract",
      path: "/api/mobile/runtime-contract",
      async assert(page, result) {
        const payload = await jsonBody(page, result, "mobile runtime contract");
        if (!payload || typeof payload !== "object") return;

        const requiredCapabilities = [
          "shared-supabase-auth-v1",
          "wedding-journey-realtime-v1",
          "mobile-web-bearer-v1",
        ];
        if (payload.version !== 1) {
          addFailure(result, `Expected mobile runtime version 1, got ${String(payload.version)}`);
        }
        if (
          typeof payload.supabaseProjectRef !== "string"
          || !/^(?:[a-z0-9]{20}|local:\d+)$/.test(payload.supabaseProjectRef)
        ) {
          addFailure(result, "Expected a bounded Supabase project ref");
        }
        if (
          !Array.isArray(payload.capabilities)
          || !requiredCapabilities.every((capability) => payload.capabilities.includes(capability))
        ) {
          addFailure(result, "Expected every required mobile/web capability");
        }
      },
    },
    {
      name: "ios-universal-link-association",
      path: "/.well-known/apple-app-site-association",
      async assert(page, result) {
        const payload = await jsonBody(page, result, "Apple association file");
        const details = payload?.applinks?.details;
        const appDetail = Array.isArray(details)
          ? details.find((detail) =>
            typeof detail?.appID === "string"
            && detail.appID.endsWith(".ai.hanbang.wedding"))
          : null;
        if (!appDetail) {
          addFailure(result, "Expected the iOS bundle id in the Apple association file");
          return;
        }
        const routes = JSON.stringify(appDetail.paths ?? appDetail.components ?? []);
        if (!routes.includes("/app")) {
          addFailure(result, "Expected the Apple association file to cover /app links");
        }
      },
    },
    {
      name: "android-app-link-association",
      path: "/.well-known/assetlinks.json",
      async assert(page, result) {
        const payload = await jsonBody(page, result, "Android association file");
        const appStatement = Array.isArray(payload)
          ? payload.find((statement) =>
            statement?.target?.namespace === "android_app"
            && statement.target.package_name === "ai.hanbang.wedding"
            && Array.isArray(statement.target.sha256_cert_fingerprints)
            && statement.target.sha256_cert_fingerprints.length > 0
            && Array.isArray(statement.relation)
            && statement.relation.includes("delegate_permission/common.handle_all_urls"))
          : null;
        if (!appStatement) {
          addFailure(result, "Expected a signed Android app-link statement");
        }
      },
    },
    {
      name: "wedding-home",
      path: "/wedding",
      async assert(_page, result) {
        if (!hasPath(result.finalUrl, "/wedding")) {
          addFailure(result, `Expected final path /wedding, got ${new URL(result.finalUrl).pathname}`);
        }
        if (!result.title) {
          addFailure(result, "Expected page to have a title");
        }
      },
    },
    {
      name: "wedding-market-prices",
      path: "/wedding/market-prices",
      async assert(_page, result) {
        if (!hasPath(result.finalUrl, "/price")) {
          addFailure(
            result,
            `Expected the legacy market-price path to redirect to /price, got ${new URL(result.finalUrl).pathname}`
          );
        }
        if (!result.title) {
          addFailure(result, "Expected market-prices page to have a title");
        }
      },
    },
    {
      name: "lounge-unauth-redirect",
      path: "/wedding/lounge",
      async assert(_page, result) {
        if (!hasPathEnding(result.finalUrl, "/login")) {
          addFailure(result, `Expected unauthenticated lounge to redirect to /login, got ${result.finalUrl}`);
        }
      },
    },
    {
      name: "mobile-wedding-home",
      path: "/wedding",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      async assert(page, result) {
        if (!hasPath(result.finalUrl, "/wedding")) {
          addFailure(result, `Expected final path /wedding, got ${new URL(result.finalUrl).pathname}`);
        }

        const horizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (horizontalOverflow > 1) {
          addFailure(result, `Expected no document-level horizontal overflow, got ${horizontalOverflow}px`);
        }

        const visibleLauncherCount = await page.getByLabel("아모라 AI 상담", { exact: true }).evaluateAll(
          (elements) => elements.filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0
              && rect.height > 0
              && rect.top < window.innerHeight
              && rect.bottom > 0
              && rect.left < window.innerWidth
              && rect.right > 0
              && style.visibility !== "hidden"
              && style.display !== "none";
          }).length,
        );
        if (visibleLauncherCount !== 1) {
          addFailure(result, `Expected exactly one visible public Amora launcher, got ${visibleLauncherCount}`);
        }
      },
    },
  ];

  if (!skipDemo) {
    checks.push({
      name: "demo-login-lounge",
      path: "/login",
      async assert(page, result, options) {
        const demoResponse = await page.request.post(`${options.baseUrl}/api/demo/start`);
        if (!demoResponse.ok()) {
          addFailure(result, `Expected demo session API to succeed, got ${demoResponse.status()}`);
          return;
        }

        const loungeResponse = await page.goto(`${options.baseUrl}/wedding/lounge`, {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs,
        });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(800);

        result.status = loungeResponse?.status() ?? result.status;
        result.finalUrl = page.url();
        result.title = await page.title().catch(() => result.title);
        result.h1 = await textOrEmpty(page.locator("h1").first());

        if (!loungeResponse || loungeResponse.status() < 200 || loungeResponse.status() >= 400) {
          addFailure(result, `Expected demo lounge to return 2xx/3xx, got ${loungeResponse?.status() ?? "none"}`);
        }
        if (!hasPath(result.finalUrl, "/wedding/lounge")) {
          addFailure(result, `Expected demo login to land on /wedding/lounge, got ${result.finalUrl}`);
        }
        if (!result.h1) {
          addFailure(result, "Expected lounge page to render an h1");
        }
      },
    });

    checks.push({
      name: "mobile-amora-panel",
      path: "/login",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      async assert(page, result, options) {
        const demoResponse = await page.request.post(`${options.baseUrl}/api/demo/start`);
        if (!demoResponse.ok()) {
          addFailure(result, `Expected demo session API to succeed, got ${demoResponse.status()}`);
          return;
        }

        const loungeResponse = await page.goto(`${options.baseUrl}/wedding/lounge`, {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs,
        });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(800);

        result.status = loungeResponse?.status() ?? result.status;
        result.finalUrl = page.url();
        result.title = await page.title().catch(() => result.title);
        result.h1 = await textOrEmpty(page.locator("h1").first());

        if (!loungeResponse || loungeResponse.status() < 200 || loungeResponse.status() >= 400) {
          addFailure(result, `Expected demo lounge to return 2xx/3xx, got ${loungeResponse?.status() ?? "none"}`);
        }
        if (!hasPath(result.finalUrl, "/wedding/lounge")) {
          addFailure(result, `Expected demo login to land on /wedding/lounge, got ${result.finalUrl}`);
        }

        const launchers = page.getByLabel("아모라 AI 상담", { exact: true });
        const launcherCount = await launchers.count();
        if (launcherCount !== 1) {
          addFailure(result, `Expected exactly one mobile Amora launcher, got ${launcherCount}`);
        }
        if (launcherCount === 0) return;

        const launcher = launchers.first();
        const launcherBox = await launcher.boundingBox();
        if (!launcherBox || launcherBox.width < 44 || launcherBox.height < 44) {
          addFailure(result, "Expected the mobile Amora launcher to provide a 44px tap target");
        }
        await launcher.click({ timeout: 5_000 });
        await page.waitForTimeout(500);

        const panel = page.locator('[role="dialog"][aria-label="아모라 AI 상담 패널"]');
        await panel.waitFor({ state: "visible", timeout: 5_000 });
        const panelBox = await panel.boundingBox();
        const viewport = page.viewportSize();
        if (!panelBox || !viewport) {
          addFailure(result, "Expected mobile Amora panel to have a visible bounding box");
          return;
        }

        const ratio = panelBox.height / viewport.height;
        if (ratio < 0.55 || ratio > 0.82) {
          addFailure(result, `Expected mobile Amora panel height ratio between 0.55 and 0.82, got ${ratio.toFixed(3)}`);
        }
        if (panelBox.y < 120) {
          addFailure(result, `Expected mobile Amora panel to leave page context visible above it, got y=${panelBox.y}`);
        }
      },
    });
  }

  return checks;
}

function markdownReport({ options, browserPath, startedAt, finishedAt, results }) {
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  const lines = [
    `# Live Smoke QA`,
    "",
    `- Started: ${startedAt}`,
    `- Finished: ${finishedAt}`,
    `- Base URL: ${options.baseUrl}`,
    `- Browser: ${browserPath}`,
    `- Result: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${results.length})`,
    "",
    `## Checks`,
    "",
    `| Check | Status | Final URL | Notes |`,
    `| --- | --- | --- | --- |`,
  ];

  for (const result of results) {
    const notes = result.ok
      ? "OK"
      : result.failures.map((failure) => failure.replace(/\|/g, "\\|")).join("<br>");
    lines.push(`| ${result.name} | ${result.ok ? "PASS" : "FAIL"} | ${result.finalUrl || result.url} | ${notes} |`);
  }

  lines.push("", "## Details", "");
  for (const result of results) {
    lines.push(`### ${result.name}`, "");
    lines.push(`- URL: ${result.url}`);
    lines.push(`- Final URL: ${result.finalUrl || "(none)"}`);
    lines.push(`- Status: ${result.status ?? "(none)"}`);
    lines.push(`- Title: ${result.title || "(none)"}`);
    lines.push(`- H1: ${result.h1 || "(none)"}`);
    lines.push(`- Screenshot: ${result.screenshot || "(none)"}`);
    if (result.failures.length > 0) {
      lines.push(`- Failures:`);
      result.failures.forEach((failure) => lines.push(`  - ${failure}`));
    }
    if (result.badResponses.length > 0) {
      lines.push(`- First-party bad responses:`);
      result.badResponses.forEach((response) => lines.push(`  - ${response.status} ${response.url}`));
    }
    if (result.consoleErrors.length > 0) {
      lines.push(`- Console errors:`);
      result.consoleErrors.forEach((message) => lines.push(`  - ${message}`));
    }
    if (result.pageErrors.length > 0) {
      lines.push(`- Page errors:`);
      result.pageErrors.forEach((message) => lines.push(`  - ${message}`));
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function printTextSummary(results, reportPath) {
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;

  console.log("");
  console.log(`Live smoke ${failed === 0 ? "passed" : "failed"}: ${passed}/${results.length}`);
  for (const result of results) {
    const marker = result.ok ? "PASS" : "FAIL";
    console.log(`- ${marker} ${result.name} -> ${result.finalUrl || result.url}`);
    result.failures.forEach((failure) => console.log(`  ${failure}`));
  }
  console.log(`Report: ${reportPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browserPath = findBrowserExecutable(options.browserPath);
  const startedAt = new Date().toISOString();
  const reportDir = path.join(REPORT_ROOT, startedAt.replace(/[:.]/g, "-"));
  await mkdir(reportDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !options.headed,
  });

  const checks = buildChecks(options.skipDemo);
  const results = [];
  try {
    for (const check of checks) {
      results.push(await runPageCheck(browser, options, reportDir, check));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const finishedAt = new Date().toISOString();
  const payload = { options, browserPath, startedAt, finishedAt, results };
  const reportPath = path.join(reportDir, "report.md");
  const jsonPath = path.join(reportDir, "result.json");

  await writeFile(reportPath, markdownReport(payload), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printTextSummary(results, reportPath);
  }

  if (results.some((result) => !result.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
