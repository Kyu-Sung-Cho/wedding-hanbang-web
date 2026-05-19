#!/usr/bin/env node
// 핵심 페이지를 6개 폭에서 스크린샷 — 반응형 검증용.
// 결과: apps/web/.screenshots/[페이지명]/[폭]px.png

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE_URL = process.env.SCREENSHOT_BASE_URL || "https://www.hanbang.ai";

const PAGES = [
  { name: "01-community", path: "/community" },
  { name: "02-quote-check", path: "/community/quote-check" },
  { name: "03-vendor-A-studio", path: `/community/vendor/${encodeURIComponent("A 스튜디오")}` },
  { name: "04-chat", path: "/chat" },
  { name: "05-landing", path: "/landing" },
  { name: "06-vendors", path: "/vendors" },
  { name: "07-about", path: "/community/about" },
  { name: "08-dashboard", path: "/dashboard" },
];

const WIDTHS = [
  { w: 375, label: "375-iphone" },
  { w: 768, label: "768-tablet" },
  { w: 1024, label: "1024-small-laptop" },
  { w: 1280, label: "1280-13inch" },
  { w: 1440, label: "1440-15inch" },
  { w: 1920, label: "1920-fhd" },
];

const OUT_ROOT = path.join(process.cwd(), ".screenshots");
mkdirSync(OUT_ROOT, { recursive: true });

const browser = await chromium.launch({ headless: true });

let captured = 0;
const failures = [];

for (const page of PAGES) {
  const pageDir = path.join(OUT_ROOT, page.name);
  mkdirSync(pageDir, { recursive: true });

  for (const { w, label } of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: w, height: 900 },
      deviceScaleFactor: 1,
      // 한국어 콘텐츠가 잘 렌더되도록
      locale: "ko-KR",
    });
    const tab = await context.newPage();
    const url = BASE_URL + page.path;
    const outFile = path.join(pageDir, `${label}.png`);

    try {
      await tab.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      // 폰트 + lazy 컴포넌트 안정화
      await tab.waitForTimeout(1500);
      await tab.screenshot({
        path: outFile,
        fullPage: true,
        animations: "disabled",
      });
      captured++;
      console.log(`✓ ${page.name} @ ${label} → ${outFile}`);
    } catch (err) {
      failures.push({ page: page.name, width: label, error: String(err).slice(0, 150) });
      console.log(`✗ ${page.name} @ ${label}: ${String(err).slice(0, 100)}`);
    } finally {
      await context.close();
    }
  }
}

await browser.close();

console.log(`\n=== Summary ===`);
console.log(`Captured: ${captured} / ${PAGES.length * WIDTHS.length}`);
console.log(`Failures: ${failures.length}`);
if (failures.length > 0) {
  console.log(`\nFailures detail:`);
  for (const f of failures) {
    console.log(`  ${f.page} @ ${f.width}: ${f.error}`);
  }
}
console.log(`\nScreenshots saved under: ${OUT_ROOT}`);
