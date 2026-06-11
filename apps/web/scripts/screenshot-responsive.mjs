#!/usr/bin/env node
// 모든 핵심 페이지를 9개 폭에서 스크린샷 — 반응형 검증용.
// 결과: apps/web/.screenshots/[페이지명]/[폭]px.png

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE_URL = process.env.SCREENSHOT_BASE_URL || "https://www.hanbang.ai";

const PAGES = [
  // public / 마케팅
  { name: "00-root", path: "/" },
  { name: "01-landing", path: "/landing" },
  { name: "02-about", path: "/about" },
  { name: "03-customer", path: "/customer" },
  { name: "04-business", path: "/business" },
  { name: "05-business-dress", path: "/business_dress" },
  { name: "06-business-makeup", path: "/business_makeup" },
  { name: "07-business-studio", path: "/business_studio" },
  { name: "08-ai-policy", path: "/ai-policy" },
  { name: "09-privacy", path: "/privacy" },
  { name: "10-terms", path: "/terms" },

  // auth
  { name: "11-login", path: "/login" },
  { name: "12-onboarding", path: "/onboarding" },

  // (app) — 로그인 안 했으면 "서비스 준비중"
  { name: "20-dashboard", path: "/dashboard" },
  { name: "21-chat", path: "/chat" },
  { name: "22-budget", path: "/budget" },
  { name: "23-schedule", path: "/schedule" },
  { name: "24-bookings", path: "/bookings" },
  { name: "25-vendors", path: "/vendors" },
  { name: "26-fitting", path: "/fitting" },
  { name: "27-etiquette", path: "/etiquette" },
  { name: "28-favorites", path: "/favorites" },
  { name: "29-market-prices", path: "/market-prices" },
  { name: "30-money", path: "/money" },
  { name: "31-settings", path: "/settings" },
  { name: "32-invitations", path: "/invitations" },
  { name: "33-scripts", path: "/scripts" },

  // community
  { name: "40-community", path: "/community" },
  { name: "41-community-about", path: "/community/about" },
  { name: "42-community-budget", path: "/community/budget" },
  { name: "43-community-schedule", path: "/community/schedule" },
  { name: "44-community-chat", path: "/community/chat" },
  { name: "45-community-quote-check", path: "/community/quote-check" },
  { name: "46-community-quick-review", path: "/community/quick-review" },
  { name: "47-community-guestbook", path: "/community/guestbook" },
  { name: "48-community-post-write", path: "/community/post/write" },
  { name: "49-vendor-A-studio", path: `/community/vendor/${encodeURIComponent("A 스튜디오")}` },

  // vendor portal
  { name: "60-vendor-login", path: "/vendor/login" },
  { name: "61-vendor-register", path: "/vendor/register" },
  { name: "62-vendor-service", path: "/vendor/service" },

  // admin
  { name: "70-admin-login", path: "/admin/login" },
];

const WIDTHS = [
  { w: 320, label: "320-iphone-se" },
  { w: 375, label: "375-iphone" },
  { w: 414, label: "414-iphone-plus" },
  { w: 768, label: "768-tablet" },
  { w: 1024, label: "1024-small-laptop" },
  { w: 1280, label: "1280-13inch" },
  { w: 1366, label: "1366-common-laptop" },
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
      locale: "ko-KR",
    });
    const tab = await context.newPage();
    const url = BASE_URL + page.path;
    const outFile = path.join(pageDir, `${label}.png`);

    try {
      await tab.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await tab.waitForTimeout(1000);
      // framer-motion whileInView / IntersectionObserver 기반 fade-in 컴포넌트를
      // visible 상태로 만들기 위해 페이지 끝까지 스크롤 후 맨 위로 복귀.
      await tab.evaluate(async () => {
        await new Promise((resolve) => {
          let y = 0;
          const step = window.innerHeight / 2;
          const tick = () => {
            window.scrollTo(0, y);
            y += step;
            if (y < document.body.scrollHeight) {
              setTimeout(tick, 80);
            } else {
              window.scrollTo(0, 0);
              setTimeout(resolve, 400);
            }
          };
          tick();
        });
      });
      await tab.waitForTimeout(500);
      await tab.screenshot({
        path: outFile,
        fullPage: true,
        animations: "disabled",
      });
      captured++;
      console.log(`✓ ${page.name} @ ${label}`);
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
