/**
 * 랜딩의 접근성 계약을 실제 Chrome에서 검증한다.
 *
 * 왜 별도 스크립트인가: 대비·터치 대상·제목 순서는 **렌더된 결과**의 성질이라
 * 소스 텍스트 정규식(landingDesignSystem.test.ts)으로는 증명할 수 없다. 색은
 * 특히 그렇다 — 클래스만 봐서는 `text-[#36534E]/70`이 어떤 배경 위에 얹혀
 * 몇 대 몇이 되는지 알 수 없고, 실제로 그 값이 12px에서 3.62:1로 미달하고
 * 있었다(2026-08-05 실측).
 *
 * 색 비교는 캔버스 왕복으로 한다. Tailwind v4가 `oklab()`으로 색을 내기 때문에
 * 문자열에서 숫자만 긁어 rgb로 읽으면 흰색이 거의 검정으로 잡히고, 어두운
 * 배경 위 텍스트가 통째로 오탐이 된다(처음 이 스크립트를 그렇게 짰다가 27건이
 * 전부 거짓 경보였다). 캔버스에 한 픽셀 칠해 되읽으면 색공간과 무관하게
 * 정확한 sRGB가 나온다.
 *
 * 검증하는 계약:
 *   1. h1은 하나이고, 제목 단계를 건너뛰지 않는다.
 *   2. aria-labelledby / aria-describedby가 실제 존재하는 id를 가리킨다.
 *   3. 보이는 링크·버튼에 접근 가능한 이름이 있고, img에 alt가 있다.
 *   4. 터치 대상이 24px 미만이 아니다(문단 안 inline은 WCAG 2.5.8 예외).
 *   5. 텍스트 대비가 WCAG 1.4.3을 만족한다(본문 4.5:1, 큰 글씨 3:1).
 *
 * 사용법 (합성 Supabase 환경의 dev 서버를 먼저 띄운다):
 *   PORT=3101 node scripts/dev-web-local.mjs
 *   LANDING_QA_URL=http://localhost:3101 node scripts/landing-a11y-qa.mjs
 *
 * 운영 데이터가 들어간 환경에서는 실행하지 않는다. 합성 환경 전용이다.
 */
import process from "node:process";
import { chromium } from "playwright-core";

import { resolveChromeExecutablePath } from "./resolve-chrome-executable.mjs";

const BASE = (process.env.LANDING_QA_URL ?? "http://localhost:3000").replace(/\/landing\/?$/u, "");

/** 데스크톱과 모바일은 다른 규칙이 걸리므로(폰트 크기 램프, 숨김 요소) 둘 다 본다. */
const VIEWPORTS = [
  { width: 1280, height: 800, label: "desktop" },
  { width: 390, height: 844, label: "mobile" },
];

function audit() {
  const issues = [];
  const add = (kind, message) => issues.push({ kind, message });

  // ── 1. 제목 순서 ────────────────────────────────────────────────────────
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  const h1Count = headings.filter((h) => h.tagName === "H1").length;
  if (h1Count !== 1) add("h1-count", `h1이 ${h1Count}개다 (1개여야 한다)`);
  let previous = 0;
  for (const heading of headings) {
    const level = Number(heading.tagName[1]);
    const text = (heading.textContent || "").trim().replace(/\s+/gu, " ").slice(0, 34);
    if (previous && level > previous + 1) add("heading-skip", `h${previous} → h${level} ("${text}")`);
    previous = level;
  }

  // ── 2. 끊어진 aria 참조 ─────────────────────────────────────────────────
  for (const attribute of ["aria-labelledby", "aria-describedby"]) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      for (const id of element.getAttribute(attribute).split(/\s+/u)) {
        if (!document.getElementById(id)) add(attribute, `없는 id "${id}" (${element.tagName})`);
      }
    }
  }

  // ── 3. 이름 없는 대화형 요소 · alt 없는 이미지 ──────────────────────────
  for (const element of document.querySelectorAll("a,button")) {
    const name = (element.getAttribute("aria-label") || element.textContent || "").trim();
    if (!name && element.getBoundingClientRect().width > 0) {
      add("no-accessible-name", `${element.tagName} ${String(element.className).slice(0, 50)}`);
    }
  }
  for (const image of document.querySelectorAll("img")) {
    if (!image.hasAttribute("alt")) add("img-alt", image.getAttribute("src")?.slice(0, 60) ?? "?");
  }

  // ── 4. 터치 대상 ────────────────────────────────────────────────────────
  for (const element of document.querySelectorAll("a,button,input,select")) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) continue;
    // 문장 안에 흐르는 inline 링크는 WCAG 2.5.8이 크기 요건에서 명시적으로 제외한다.
    const inlineInParagraph = element.closest("p") && getComputedStyle(element).display.includes("inline");
    if (!inlineInParagraph && (rect.height < 24 || rect.width < 24)) {
      const label = (element.textContent || "").trim().slice(0, 24);
      add("target-size", `${Math.round(rect.width)}×${Math.round(rect.height)} "${label}"`);
    }
  }

  // ── 5. 대비 ─────────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  /** 어떤 색공간이든(oklab, oklch, color-mix…) 정확한 sRGB로 되읽는다. */
  const toRGBA = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const luminance = (color) => {
    const [r, g, b] = color.slice(0, 3).map((value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /** 반투명 배경은 건너뛰고 실제로 색을 정하는 조상까지 올라간다. */
  const backgroundOf = (element) => {
    let node = element;
    while (node && node !== document.documentElement) {
      const color = toRGBA(getComputedStyle(node).backgroundColor);
      if (color[3] > 0.85) return color;
      node = node.parentElement;
    }
    return [255, 255, 255, 1];
  };

  const TEXT_HOSTS = "p,span,a,button,h1,h2,h3,h4,h5,h6,li,dt,dd,div,label,td,th";
  for (const element of document.querySelectorAll(TEXT_HOSTS)) {
    // 자식이 아니라 이 요소가 직접 가진 텍스트만 본다(색이 그 요소에서 정해진다).
    const ownText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
      .map((node) => node.textContent.trim())
      .join(" ");
    if (!ownText) continue;

    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (element.getBoundingClientRect().width === 0) continue;

    const foreground = toRGBA(style.color);
    const background = backgroundOf(element);
    // 텍스트 알파를 배경에 합성해야 실제로 보이는 색이 나온다.
    const effective = foreground
      .slice(0, 3)
      .map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]));

    const l1 = luminance(effective);
    const l2 = luminance(background);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    const px = Number.parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const required = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < required - 0.01) {
      add(
        "contrast",
        `${ratio.toFixed(2)}:1 (필요 ${required}:1) ${Math.round(px)}px "${ownText.slice(0, 34)}"`,
      );
    }
  }

  return issues;
}

async function run() {
  const browser = await chromium.launch({ executablePath: resolveChromeExecutablePath() });
  let failures = 0;
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.goto(`${BASE}/landing`, { waitUntil: "networkidle" });
      const issues = await page.evaluate(audit);

      // 같은 문제가 반복 요소마다 잡히면 목록이 길어지기만 한다.
      const unique = [...new Map(issues.map((i) => [`${i.kind}|${i.message}`, i])).values()];
      console.log(`\n[${viewport.label} ${viewport.width}px] ${unique.length ? `문제 ${unique.length}건` : "문제 없음"}`);
      for (const issue of unique) console.log(`  - ${issue.kind}: ${issue.message}`);
      failures += unique.length;

      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "접근성 계약 통과" : `접근성 문제 ${failures}건`}`);
  if (failures > 0) process.exitCode = 1;
}

await run();
