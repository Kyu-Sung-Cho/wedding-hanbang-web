#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const DEFAULT_BASE_URL = "https://hanbang.ai";
const DEFAULT_TIMEOUT_MS = 45_000;
const REPORT_ROOT = ".gstack/qa-reports/live-smoke";

export function parseArgs(argv, env = process.env) {
  const options = {
    baseUrl: env.LIVE_SMOKE_BASE_URL || DEFAULT_BASE_URL,
    browserPath: env.LIVE_SMOKE_BROWSER_PATH || "",
    headed: env.LIVE_SMOKE_HEADED === "1",
    json: false,
    launchMode: env.LIVE_SMOKE_LAUNCH_MODE || "full",
    expectedSha: env.LIVE_SMOKE_EXPECTED_SHA || "",
    expectedSupabaseProjectRef:
      env.LIVE_SMOKE_EXPECTED_SUPABASE_PROJECT_REF || "",
    appleTeamId: env.LIVE_SMOKE_APPLE_TEAM_ID || "",
    playSigningSha256: env.LIVE_SMOKE_PLAY_SIGNING_SHA256 || "",
    researchIntake: env.LIVE_SMOKE_RESEARCH_INTAKE || "closed",
    accountDeletionCron: env.LIVE_SMOKE_ACCOUNT_DELETION_CRON || "closed",
    skipDemo: env.LIVE_SMOKE_SKIP_DEMO === "1",
    allowUnboundLocal: env.LIVE_SMOKE_ALLOW_UNBOUND_LOCAL === "1",
    timeoutMs: Number(env.LIVE_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };

  for (const arg of argv) {
    // pnpm may preserve the conventional argument separator for script
    // commands. Accept it without weakening unknown-option validation.
    if (arg === "--") continue;
    if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--browser-path=")) options.browserPath = arg.slice("--browser-path=".length);
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else if (arg.startsWith("--launch-mode=")) options.launchMode = arg.slice("--launch-mode=".length);
    else if (arg.startsWith("--expected-sha=")) options.expectedSha = arg.slice("--expected-sha=".length);
    else if (arg.startsWith("--expected-supabase-project-ref=")) {
      options.expectedSupabaseProjectRef = arg.slice(
        "--expected-supabase-project-ref=".length
      );
    }
    else if (arg.startsWith("--apple-team-id=")) options.appleTeamId = arg.slice("--apple-team-id=".length);
    else if (arg.startsWith("--play-signing-sha256=")) options.playSigningSha256 = arg.slice("--play-signing-sha256=".length);
    else if (arg.startsWith("--research-intake=")) options.researchIntake = arg.slice("--research-intake=".length);
    else if (arg.startsWith("--account-deletion-cron=")) options.accountDeletionCron = arg.slice("--account-deletion-cron=".length);
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--skip-demo") options.skipDemo = true;
    else if (arg === "--allow-unbound-local") options.allowUnboundLocal = true;
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
  if (!["full", "coming_soon"].includes(options.launchMode)) {
    throw new Error("--launch-mode must be full or coming_soon");
  }
  if (!["closed", "open"].includes(options.researchIntake)) {
    throw new Error("--research-intake must be closed or open");
  }
  if (!["closed", "open"].includes(options.accountDeletionCron)) {
    throw new Error("--account-deletion-cron must be closed or open");
  }
  const baseHostname = new URL(options.baseUrl).hostname;
  const isLocalTarget = ["localhost", "127.0.0.1", "::1"].includes(baseHostname);
  if (options.allowUnboundLocal && !isLocalTarget) {
    throw new Error("--allow-unbound-local is restricted to localhost targets");
  }
  if (!options.allowUnboundLocal && !isPlausibleCommitSha(options.expectedSha)) {
    throw new Error(
      "--expected-sha must be the exact non-placeholder 40-character deployment commit"
    );
  }
  if (
    !options.allowUnboundLocal
    && !/^[a-z0-9]{20}$/.test(options.expectedSupabaseProjectRef)
  ) {
    throw new Error(
      "--expected-supabase-project-ref must be the exact 20-character Supabase project ref"
    );
  }
  if (!options.allowUnboundLocal && !isPlausibleAppleTeamId(options.appleTeamId)) {
    throw new Error("--apple-team-id must match the signed 10-character Apple Team ID for every remote release");
  }
  if (!options.allowUnboundLocal && !isPlausibleSigningFingerprint(options.playSigningSha256)) {
    throw new Error("--play-signing-sha256 must match the Play App Signing SHA-256 for every remote release");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm qa:live [options]

Options:
  --base-url=<url>       Target origin. Default: ${DEFAULT_BASE_URL}
  --browser-path=<path>  Chrome or Edge executable path.
  --timeout-ms=<ms>      Per-page timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --launch-mode=<mode>   full or coming_soon. Default: full
  --expected-sha=<sha>   Exact non-placeholder 40-character deployed commit; required for remote targets.
  --expected-supabase-project-ref=<ref>  Exact 20-character Supabase project ref; required for remote targets.
  --apple-team-id=<id>   Signed 10-character Apple Team ID; required for every remote release.
  --play-signing-sha256=<fingerprint>  Play App Signing SHA-256; required for every remote release.
  --research-intake=<state>  closed or open. Default: closed.
  --account-deletion-cron=<state>  closed or open. Default: closed.
  --headed               Show the browser window.
  --skip-demo            Skip demo login flow.
  --allow-unbound-local  Skip SHA/project identity only for localhost development.
  --json                 Print JSON result only.

Environment:
  LIVE_SMOKE_BASE_URL
  LIVE_SMOKE_BROWSER_PATH
  LIVE_SMOKE_TIMEOUT_MS
  LIVE_SMOKE_LAUNCH_MODE
  LIVE_SMOKE_EXPECTED_SHA
  LIVE_SMOKE_EXPECTED_SUPABASE_PROJECT_REF
  LIVE_SMOKE_APPLE_TEAM_ID
  LIVE_SMOKE_PLAY_SIGNING_SHA256
  LIVE_SMOKE_RESEARCH_INTAKE
  LIVE_SMOKE_ACCOUNT_DELETION_CRON
  LIVE_SMOKE_ALLOW_UNBOUND_LOCAL=1
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

export function releaseHealthFailures(
  { status, body, cacheControl = "" },
  options,
) {
  const failures = [];
  if (status !== 200 || !body || typeof body !== "object" || Array.isArray(body)) {
    failures.push(`Expected release health JSON with HTTP 200, got ${status ?? "none"}`);
    return failures;
  }
  if (!cacheControl.toLowerCase().includes("no-store")) {
    failures.push("Expected release health response to disable caching");
  }
  if (!options.allowUnboundLocal) {
    if (body.deployment !== options.expectedSha.toLowerCase()) {
      failures.push(
        `Expected health deployment ${options.expectedSha.toLowerCase()}, got ${body.deployment ?? "none"}`
      );
    }
    if (body.supabaseProjectRef !== options.expectedSupabaseProjectRef) {
      failures.push(
        `Expected Supabase project ${options.expectedSupabaseProjectRef}, got ${body.supabaseProjectRef ?? "none"}`
      );
    }
  }
  if (body.rateLimitKeySecretConfigured !== true) {
    failures.push("Expected a strong configured rate-limit key secret");
  }
  if (body.turnstileCredentialsConfigured !== true) {
    failures.push("Expected a plausible complete Turnstile credential pair");
  }
  if (body.turnstileCanonicalHostnameConfigured !== true) {
    failures.push("Expected the Turnstile configuration hostname to be exactly hanbang.ai");
  }
  if (body.turnstileConfigured !== true) {
    failures.push("Expected complete Turnstile credentials and canonical configuration boundary");
  }
  if (body.maintenance !== false) {
    failures.push(`Expected maintenance mode off, got ${String(body.maintenance)}`);
  }
  if (body.maintenanceStartedAt !== null) {
    failures.push("Expected stale maintenance start metadata to be cleared");
  }

  const expectedResearchIntake = options.researchIntake === "open";
  if (body.researchCohortApplicationsEnabled !== expectedResearchIntake) {
    failures.push(
      `Expected research intake ${options.researchIntake}, got ${String(body.researchCohortApplicationsEnabled)}`
    );
  }
  const expectedAccountDeletionCron = options.accountDeletionCron === "open";
  if (body.accountDeletionCronEnabled !== expectedAccountDeletionCron) {
    failures.push(
      `Expected account-deletion cron ${options.accountDeletionCron}, got ${String(body.accountDeletionCronEnabled)}`
    );
  }
  return failures;
}

function buildReleaseHealthCheck() {
  return {
    name: "release-health-contract",
    path: "/api/health/maintenance",
    async assert(page, result, options) {
      const response = await page.request.get(
        `${options.baseUrl}/api/health/maintenance`,
        { maxRedirects: 0 }
      );
      const body = await response.json().catch(() => null);
      const failures = releaseHealthFailures(
        {
          status: response.status(),
          body,
          cacheControl: response.headers()["cache-control"] ?? "",
        },
        options,
      );
      for (const failure of failures) addFailure(result, failure);
    },
  };
}

function buildFullChecks(skipDemo) {
  const checks = [
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
        if (!hasPath(result.finalUrl, "/wedding/market-prices")) {
          addFailure(
            result,
            `Expected final path /wedding/market-prices, got ${new URL(result.finalUrl).pathname}`
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

        const launcher = page.getByLabel("아모라 AI 상담").last();
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

function isPlausibleCommitSha(value) {
  return /^[0-9a-f]{40}$/i.test(value)
    && new Set(value.toLowerCase()).size >= 8
    && !looksLikeObviousPlaceholder(value);
}

function isPlausibleAppleTeamId(value) {
  return /^[A-Z0-9]{10}$/.test(value)
    && new Set(value).size >= 4
    && !/(?:TEAM|APPLE|EXAMPLE|PLACEHOLDER)/.test(value)
    && !looksLikeObviousPlaceholder(value);
}

function isPlausibleSigningFingerprint(value) {
  if (!/^(?:[0-9a-f]{64}|(?:[0-9a-f]{2}:){31}[0-9a-f]{2})$/i.test(value)) {
    return false;
  }
  const compact = value.replaceAll(":", "").toUpperCase();
  const bytes = compact.match(/.{2}/g) ?? [];
  return new Set(bytes).size >= 8 && !looksLikeObviousPlaceholder(compact);
}

function looksLikeObviousPlaceholder(value) {
  const compact = value.replaceAll(":", "").toUpperCase();
  return compact.includes("0123456789")
    || compact.includes("9876543210")
    || /^(.{1,20})\1+$/.test(compact);
}

function normalizeSha256Fingerprint(value) {
  return value.replaceAll(":", "").toUpperCase().match(/.{2}/g).join(":");
}

async function assertSignedAppAssociations(page, result, options) {
  for (const associationPath of [
    "/apple-app-site-association",
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
  ]) {
    const response = await page.request.get(
      `${options.baseUrl}${associationPath}`,
      { maxRedirects: 0 }
    );
    if (response.status() !== 200) {
      addFailure(
        result,
        `Expected signed-app association ${associationPath} to return direct 200, got ${response.status()}`
      );
      continue;
    }
    const body = await response.json().catch(() => null);
    if (associationPath.endsWith("assetlinks.json")) {
      const expectedFingerprint = normalizeSha256Fingerprint(options.playSigningSha256);
      const matchingTarget = Array.isArray(body) && body.some((entry) =>
        entry?.target?.package_name === "ai.hanbang.wedding"
        && entry?.target?.sha256_cert_fingerprints?.includes(expectedFingerprint)
      );
      if (!matchingTarget) {
        addFailure(
          result,
          "Asset Links does not match the approved Android package and Play signing fingerprint"
        );
      }
    } else {
      const details = body?.applinks?.details;
      const matchingApp = Array.isArray(details) && details.some((entry) =>
        entry?.appID === `${options.appleTeamId}.ai.hanbang.wedding`
        && ["/app", "/app/community/post/*", "/app/vendors/*"].every(
          (path) => entry?.paths?.includes(path)
        )
      );
      if (!matchingApp) {
        addFailure(
          result,
          "AASA does not match the signed iOS app ID and approved share routes"
        );
      }
    }
  }
}

function buildAssociationCheck() {
  return {
    name: "signed-app-associations",
    path: "/demo",
    async assert(page, result, options) {
      await assertSignedAppAssociations(page, result, options);
    },
  };
}

function buildComingSoonChecks() {
  return [
    {
      name: "coming-soon-demo",
      path: "/demo?utm_source=live-smoke",
      async assert(page, result, options) {
        const final = new URL(result.finalUrl);
        if (final.pathname !== "/demo" || final.searchParams.get("utm_source") !== "live-smoke") {
          addFailure(result, `Expected launch-safe /demo with UTM preserved, got ${result.finalUrl}`);
        }
        if (!result.title || !result.h1) addFailure(result, "Expected the service introduction to render a title and h1");

        for (const publicPath of ["/beta", "/about", "/privacy", "/terms", "/ai-policy", "/support"]) {
          const response = await page.request.get(`${options.baseUrl}${publicPath}`, { maxRedirects: 0 });
          if (response.status() !== 200) {
            addFailure(result, `Expected public allowlist ${publicPath} to return 200, got ${response.status()}`);
          }
        }

        await assertSignedAppAssociations(page, result, options);

      },
    },
    {
      name: "coming-soon-login-redirect",
      path: "/login?utm_campaign=live-smoke&next=%2Fadmin",
      async assert(_page, result) {
        const final = new URL(result.finalUrl);
        if (final.pathname !== "/demo") {
          addFailure(result, `Expected /login to redirect to /demo, got ${result.finalUrl}`);
        }
        if (final.searchParams.get("utm_campaign") !== "live-smoke" || final.searchParams.has("next")) {
          addFailure(result, `Expected only bounded campaign parameters after redirect, got ${final.search}`);
        }
      },
    },
    {
      name: "coming-soon-app-redirect",
      path: "/wedding?utm_source=live-smoke&next=%2Fadmin",
      async assert(_page, result) {
        const final = new URL(result.finalUrl);
        if (final.pathname !== "/demo" || final.searchParams.get("utm_source") !== "live-smoke" || final.searchParams.has("next")) {
          addFailure(result, `Expected gated app route to land on sanitized /demo, got ${result.finalUrl}`);
        }
      },
    },
    {
      name: "coming-soon-api-closed",
      path: "/demo",
      async assert(page, result, options) {
        const response = await page.request.post(`${options.baseUrl}/api/auth/signup`, {
          data: { email: "live-smoke@example.invalid", password: "not-a-real-password" },
          maxRedirects: 0,
        });
        const body = await response.json().catch(() => null);
        if (response.status() !== 503 || body?.code !== "SERVICE_NOT_LAUNCHED") {
          addFailure(result, `Expected general API to fail closed with SERVICE_NOT_LAUNCHED, got ${response.status()}`);
        }
        if (response.headers()["cache-control"]?.includes("no-store") !== true) {
          addFailure(result, "Expected blocked API response to disable caching");
        }

        const betaResponse = await page.request.get(`${options.baseUrl}/beta`, { maxRedirects: 0 });
        const betaHtml = await betaResponse.text();
        if (options.researchIntake === "closed") {
          if (!betaHtml.includes("준비가 끝나기 전에는 개인정보를 받지 않습니다")) {
            addFailure(result, "Expected the closed research page to omit its PII form");
          }
          const intakeResponse = await page.request.post(`${options.baseUrl}/api/preregister`, {
            data: {},
            maxRedirects: 0,
          });
          const intakeBody = await intakeResponse.json().catch(() => null);
          if (intakeResponse.status() !== 503 || intakeBody?.code !== "RESEARCH_INTAKE_CLOSED") {
            addFailure(result, `Expected research intake to fail closed, got ${intakeResponse.status()}`);
          }
          if (intakeResponse.headers()["cache-control"]?.includes("no-store") !== true) {
            addFailure(result, "Expected closed research intake response to disable caching");
          }
        } else if (!betaHtml.includes("사용자 연구 신청하기")) {
          addFailure(result, "Expected the approved research application form to be visible");
        }
      },
    },
  ];
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

  const modeChecks = options.launchMode === "coming_soon"
    ? buildComingSoonChecks()
    : buildFullChecks(options.skipDemo);
  const associationChecks = options.launchMode === "full" && !options.allowUnboundLocal
    ? [buildAssociationCheck()]
    : [];
  const checks = [buildReleaseHealthCheck(), ...associationChecks, ...modeChecks];
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

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
