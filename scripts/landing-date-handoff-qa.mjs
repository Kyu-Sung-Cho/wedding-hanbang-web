/**
 * 랜딩 → /start-here 날짜 handoff의 개인정보 경로를 실제 Chrome에서 검증한다.
 *
 * 왜 별도 스크립트인가: 이 흐름의 계약은 "날짜가 서버로 나가지 않는다"이고, 그건
 * jsdom 단위 테스트로는 증명할 수 없다. 실제 브라우저가 실제로 어떤 HTTP 요청을
 * 보내는지 봐야 한다. 인계 문서(LANDING_CONSUMER_EXPERIENCE_HANDOFF_2026-08-04.md §8)도
 * 이 구간을 "production Preview가 생기면 실제 Chrome/Safari에서 수동 smoke test"로
 * 남겨 두었다. 이 스크립트가 Chrome 쪽을 자동화한다. Safari는 여전히 수동이다.
 *
 * 검증하는 계약(같은 문서 §5):
 *   1. 날짜가 서버 query parameter로 나가지 않는다.
 *   2. sessionStorage에 임시 저장했다가 /start-here가 읽고 즉시 지운다.
 *   3. 저장소가 막히면 `#date=` fragment로 넘어간다. fragment는 HTTP 요청과
 *      Referer에 포함되지 않는다 — 이 설계의 핵심이다.
 *   4. 읽은 뒤 주소의 fragment도 지운다.
 *   5. 중단된 이전 이동이 남긴 날짜가 "날짜 없이 시작"을 덮지 않는다.
 *
 * 사용법 (합성 Supabase 환경의 dev 서버를 먼저 띄운다):
 *   PORT=3101 node scripts/dev-web-local.mjs
 *   LANDING_QA_URL=http://localhost:3101 node scripts/landing-date-handoff-qa.mjs
 *
 * 운영 데이터가 들어간 환경에서는 실행하지 않는다. 합성 환경 전용이다.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { resolveChromeExecutablePath } from "./resolve-chrome-executable.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
void scriptDirectory;

const BASE = (process.env.LANDING_QA_URL ?? "http://localhost:3000").replace(/\/landing\/?$/u, "");
const STORAGE_KEY = "hanbang:start-here-date:v1";
/** 실제 사용자 날짜가 아닌 합성 값. 유출 감시의 마커로도 쓴다. */
const SYNTHETIC_DATE = "2027-05-22";
const STALE_DATE = "2099-01-01";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** 모든 요청의 URL과 Referer를 모아 날짜 유출을 감시한다. */
function watchRequests(page) {
  const seen = [];
  page.on("request", (request) => {
    seen.push({
      url: request.url(),
      referer: request.headers().referer ?? "",
    });
  });
  return seen;
}

function leaks(requests) {
  return requests.filter(
    (r) => r.url.includes(SYNTHETIC_DATE) || r.referer.includes(SYNTHETIC_DATE),
  );
}

async function run() {
  const browser = await chromium.launch({
    executablePath: resolveChromeExecutablePath(),
    headless: true,
  });

  try {
    // ── 1. 정상 경로 ────────────────────────────────────────────────────
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const requests = watchRequests(page);

      await page.goto(`${BASE}/landing`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.fill("#landing-wedding-date", SYNTHETIC_DATE);
      check(
        "날짜 입력이 React 상태에 반영된다",
        (await page.inputValue("#landing-wedding-date")) === SYNTHETIC_DATE,
      );

      await Promise.all([
        page.waitForURL(/\/start-here/u, { timeout: 30_000 }),
        page.click('form button[type="submit"]'),
      ]);
      await page.waitForTimeout(1200);

      const url = new URL(page.url());
      check("주소에 query string이 없다", url.search === "", `search="${url.search}"`);
      check("주소에 fragment가 남지 않는다", url.hash === "", `hash="${url.hash}"`);

      const leaked = leaks(requests);
      check(
        "어떤 요청의 URL·Referer에도 날짜가 없다",
        leaked.length === 0,
        leaked.length ? JSON.stringify(leaked[0]).slice(0, 140) : `${requests.length}개 요청 검사`,
      );

      check(
        "적용 뒤 sessionStorage가 비워진다",
        (await page.evaluate((k) => window.sessionStorage.getItem(k), STORAGE_KEY)) === null,
      );
      check(
        "start-here의 날짜 입력에 값이 적용된다",
        (await page.evaluate(() => document.querySelector('input[type="date"]')?.value ?? null))
          === SYNTHETIC_DATE,
      );

      await context.close();
    }

    // ── 2. 저장소가 막힌 브라우저: fragment fallback ──────────────────────
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const requests = watchRequests(page);

      await page.addInitScript(() => {
        const proto = Object.getPrototypeOf(window.sessionStorage);
        const original = proto.setItem;
        proto.setItem = function setItem(key, value) {
          if (String(key).startsWith("hanbang:start-here-date")) {
            throw new DOMException("blocked", "SecurityError");
          }
          return original.call(this, key, value);
        };
      });

      await page.goto(`${BASE}/landing`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.fill("#landing-wedding-date", SYNTHETIC_DATE);
      await Promise.all([
        page.waitForURL(/\/start-here/u, { timeout: 30_000 }),
        page.click('form button[type="submit"]'),
      ]);
      await page.waitForTimeout(1200);

      const leaked = leaks(requests);
      check(
        "저장소가 막혀도 날짜가 HTTP 요청에 실리지 않는다",
        leaked.length === 0,
        leaked.length ? JSON.stringify(leaked[0]).slice(0, 140) : `${requests.length}개 요청 검사`,
      );
      check(
        "fragment도 읽은 뒤 주소에서 지워진다",
        (await page.evaluate(() => window.location.hash)) === "",
      );

      await context.close();
    }

    // ── 3. "날짜 없이 시작"이 남은 날짜를 덮지 않는다 ──────────────────────
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();

      await page.goto(`${BASE}/landing`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.evaluate(
        ([key, value]) => window.sessionStorage.setItem(key, value),
        [STORAGE_KEY, STALE_DATE],
      );

      await Promise.all([
        page.waitForURL(/\/start-here/u, { timeout: 30_000 }),
        page.click("text=날짜가 아직 없어요"),
      ]);
      await page.waitForTimeout(1000);

      check(
        "날짜 없이 시작하면 남아 있던 날짜가 지워진다",
        (await page.evaluate((k) => window.sessionStorage.getItem(k), STORAGE_KEY)) === null,
      );
      check(
        "남아 있던 날짜가 화면에 적용되지 않는다",
        (await page.evaluate(() => document.querySelector('input[type="date"]')?.value ?? ""))
          !== STALE_DATE,
      );

      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  if (failed.length > 0) {
    console.log("실패:");
    for (const f of failed) console.log(`  - ${f.name}  ${f.detail}`);
    process.exitCode = 1;
  }
}

await run();
