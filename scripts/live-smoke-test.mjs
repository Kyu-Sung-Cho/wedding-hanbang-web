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
      // 도메인 루트가 랜딩에 도착한다 (2026-08-27 파운더 결정).
      //
      // 이 케이스가 없어서, 루트가 로그인으로 가던 시절에도 라이브에서는 아무도
      // 몰랐다. `/wedding/lounge` 는 보호 경로라 다른 판정을 밟는다 — 루트는
      // **문**이고 세션에 따라 갈리므로 따로 밟아야 한다.
      //
      // 여기 실패하면 광고·외부 링크·입소문이 전부 잘못된 곳에 착지하고 있다는 뜻이다.
      name: "root-door-unauth-lands-on-landing",
      path: "/",
      async assert(page, result) {
        if (!hasPathEnding(result.finalUrl, "/landing")) {
          addFailure(
            result,
            `Expected domain root to land on /landing for a signed-out visitor, got ${result.finalUrl}`,
          );
          return;
        }
        // 도착만 하고 빈 문서면 소용이 없다. 첫 화면이 실제로 무언가 말하는지 본다.
        const heading = await page.evaluate(
          () => document.querySelector("h1")?.textContent?.trim() ?? "",
        );
        if (heading.length < 8) {
          addFailure(result, `Landing rendered without an H1 (got ${JSON.stringify(heading)})`);
        }
      },
    },
    {
      // 유입 표식이 목적지까지 간다. 루트에서 끊기면 어느 캠페인에서 왔는지 사라진다.
      name: "root-door-keeps-utm",
      path: "/?utm_source=smoke&utm_campaign=root-door",
      async assert(_page, result) {
        const url = new URL(result.finalUrl);
        if (!hasPathEnding(result.finalUrl, "/landing")) {
          addFailure(result, `Expected /landing, got ${url.pathname}`);
          return;
        }
        if (url.searchParams.get("utm_source") !== "smoke") {
          addFailure(result, `Root door dropped utm_source (${url.search || "no query"})`);
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

    // 모바일에서 컨트롤이 자기 모양을 지키는가.
    //
    // globals.css 의 44px 최소 탭타깃 규칙은 레이어 밖에 있어서 Tailwind 의 `h-*`/`min-h-*`
    // 유틸리티를 전부 이긴다. 그래서 한때 `w-12 h-7 rounded-full` 로 그린 알림 토글이
    // 44x44 원이 되고 안의 knob(absolute 24px)이 트랙 밖으로 삐져나왔다 —
    // 2026-08-26 운영에서 "한 입 베어 문 동그라미"로 보였다.
    //
    // 이 검사는 그 회귀를 화면에서 잡는다. 소스에 특정 클래스가 있는지 묻지 않고,
    // **실제로 렌더된 상자**를 잰다. 그래야 CSS 쪽에서 되돌려도 걸린다.
    checks.push({
      name: "mobile-control-geometry",
      path: "/login",
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      async assert(page, result, options) {
        // 데모 세션은 **페이지 안에서** 만든다. `page.request.post` 는 브라우저 fetch
        // 메타데이터(`sec-fetch-site`, `Origin`)를 안 붙여서 `/api/demo/start` 의
        // 교차출처 가드에 403 으로 막힌다 — 같은 이유로 이 파일의 다른 데모 검사들도
        // 지금 403 을 받고 있다. 여기서는 진짜 브라우저 요청으로 연다.
        const demoStatus = await page.evaluate(async () => {
          const response = await fetch("/api/demo/start", { method: "POST", credentials: "include" });
          return response.status;
        });
        if (demoStatus < 200 || demoStatus >= 300) {
          addFailure(result, `Expected demo session API to succeed, got ${demoStatus}`);
          return;
        }

        await page.goto(`${options.baseUrl}/wedding/settings`, {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs,
        });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(800);
        result.finalUrl = page.url();
        result.title = await page.title().catch(() => result.title);

        const switches = page.locator('[role="switch"]');
        const switchCount = await switches.count();
        if (switchCount === 0) {
          addFailure(result, "Expected the settings page to render notification switches");
          return;
        }

        const geometry = await page.evaluate(() => {
          const track = document.querySelector('[role="switch"]');
          track.scrollIntoView({ block: "center", behavior: "instant" });
          const trackBox = track.getBoundingClientRect();
          const knob = track.children[0] ? track.children[0].getBoundingClientRect() : null;
          const cx = trackBox.left + trackBox.width / 2;
          const cy = trackBox.top + trackBox.height / 2;
          // 44px 탭 영역이 살아 있는지 — 보이는 상자 위/아래 밖을 눌러도 스위치가 잡혀야 한다.
          const outsideBox = (dy) => {
            const hit = document.elementFromPoint(cx, cy + dy);
            return !!hit && (hit === track || track.contains(hit));
          };
          const reach = 21 - trackBox.height / 2;
          return {
            width: Math.round(trackBox.width * 10) / 10,
            height: Math.round(trackBox.height * 10) / 10,
            knobOverhangRight: knob ? Math.round((knob.right - trackBox.right) * 10) / 10 : null,
            knobOverhangBottom: knob ? Math.round((knob.bottom - trackBox.bottom) * 10) / 10 : null,
            tapReachesAbove: reach > 1 ? outsideBox(-reach) : true,
            tapReachesBelow: reach > 1 ? outsideBox(reach) : true,
          };
        });

        // 알약이어야 한다. 44x44 로 부풀면 폭/높이 비가 1 이 되어 원이 된다.
        if (geometry.height > 32) {
          addFailure(
            result,
            `Expected the notification switch to keep its 28px track height, got ${geometry.height}px (44px tap-target rule likely inflated it)`,
          );
        }
        if (geometry.width < geometry.height * 1.4) {
          addFailure(
            result,
            `Expected the notification switch to render as a pill, got ${geometry.width}x${geometry.height}`,
          );
        }
        if (geometry.knobOverhangRight !== null && geometry.knobOverhangRight > 0) {
          addFailure(
            result,
            `Expected the switch knob to stay inside its track, it overhangs by ${geometry.knobOverhangRight}px`,
          );
        }
        if (geometry.knobOverhangBottom !== null && geometry.knobOverhangBottom > 0) {
          addFailure(
            result,
            `Expected the switch knob to stay inside its track vertically, it overhangs by ${geometry.knobOverhangBottom}px`,
          );
        }
        // 모양을 되찾는 대가로 손가락이 닿는 영역까지 잃으면 안 된다.
        if (!geometry.tapReachesAbove || !geometry.tapReachesBelow) {
          addFailure(
            result,
            "Expected the switch to keep a 44px tap area beyond its visible track (.tap-area)",
          );
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
