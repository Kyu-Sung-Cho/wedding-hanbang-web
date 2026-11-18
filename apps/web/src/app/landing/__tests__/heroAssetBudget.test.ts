// @vitest-environment jsdom

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";
import { landingContent } from "@/components/landing/redesign/landingContent";

import LandingPage from "../page";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

const appRoot = resolve(process.cwd());

/**
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다")으로 시작 화면 아래 섹션에
 * 예시 화면 네 장이 들어왔다(전화기 셋, 넓은 화면 하나). 카피(`landingContent`)가 그 목록의 정본이다.
 * 보내기 전 편지 승인 화면은 파운더 결정 D-83(문의 글은 함께 쓰고 두 분이 직접 보낸다)으로 싣지 않는다.
 */
const LANDING_SHOTS = [
  ...landingContent.today.features.map((feature) => feature.shot),
  ...landingContent.today.soonFeatures.map((feature) => feature.shot),
  landingContent.wide.shot,
];
/** 전화기 화면은 600px 폭, 넓은 화면은 2160px 폭이다. 글자가 많은 화면이라 이만큼은 둔다. */
const PHONE_SHOT_BUDGET = 64 * 1024;
const WIDE_SHOT_BUDGET = 128 * 1024;

/** WebP 머리에서 가로·세로를 읽는다(VP8 손실 · VP8L 무손실 · VP8X 확장). */
function webpSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 4).toString(), "RIFF 가 아니다").toBe("RIFF");
  expect(buffer.subarray(8, 12).toString(), "WebP 가 아니다").toBe("WEBP");
  const chunk = buffer.subarray(12, 16).toString();
  if (chunk === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error(`모르는 WebP 조각: ${chunk}`);
}

/**
 * 첫 화면 자산 예산.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 첫 화면은 보케 사진 한 장과
 * 아모라 오브 하나다. 옛 판은 꽃 SVG 넷의 크기를 쟀고 "히어로에 그림 없음"을 요구했다 —
 * 새 디자인을 구조적으로 금지하던 단언이라, 같은 자리에서 **새 첫 화면의 무게**를 잰다.
 * 커뮤니티의 공유 WebP 자산과 랜딩 공유 카드 계약은 그대로 둔다.
 */
const bokehPhoto = resolve(appRoot, "public/images/amora/bokeh-blush.webp");
const optimizedHero = resolve(appRoot, "public/images/amora-hero-bouquet-custom.webp");
const bouquetSourceFiles = [
  "src/app/(community)/community/cohort/page.tsx",
  "src/app/(community)/community/cohort/[id]/page.tsx",
];
const landingSocialCard = resolve(appRoot, "public/images/landing-social-card.webp");

function landingDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
}

describe("hero image performance budget", () => {
  it("serves the start-screen photo as a small WebP", () => {
    // 보케 사진은 첫 화면 전체를 덮는다. 흐린 사진이라 작아도 되고, 커지면 첫 화면이 늦게 뜬다.
    expect(existsSync(bokehPhoto), "보케 사진이 없다").toBe(true);
    expect(readFileSync(bokehPhoto).subarray(8, 12).toString(), "WebP 가 아니다").toBe("WEBP");
    expect(statSync(bokehPhoto).size).toBeLessThanOrEqual(64 * 1024);
  });

  it("serves the shared bouquet hero as a bounded WebP asset", () => {
    // 랜딩 밖(커뮤니티 동기방)의 자산 계약이라 그대로 남긴다.
    expect(statSync(optimizedHero).size).toBeLessThanOrEqual(350 * 1024);
    for (const sourceFile of bouquetSourceFiles) {
      const source = readFileSync(resolve(appRoot, sourceFile), "utf8");
      expect(source).toContain("/images/amora-hero-bouquet-custom.webp");
      expect(source).not.toContain("/images/amora-hero-bouquet-custom.png");
    }
  });

  it("bounds the markup the start screen actually renders", () => {
    // 첫 화면의 그림은 사진 한 장과 오브 하나뿐이다. 장식 SVG 가 다시 쌓이면 여기서 운다.
    // 2026-11-18: 시작 화면 아래 섹션이 생겨 <main> 이 아니라 시작 화면 상자 안을 센다.
    const doc = landingDocument();
    const startFrame = doc.querySelector('section[aria-labelledby="start-title"]')?.parentElement;
    expect(startFrame, "시작 화면 상자를 못 찾았다").toBeTruthy();
    expect(startFrame!.querySelectorAll("img"), "첫 화면 사진이 한 장이 아니다").toHaveLength(1);
    const startSvgs = [...startFrame!.querySelectorAll("svg")];
    expect(startSvgs, "첫 화면 SVG 가 오브 하나가 아니다").toHaveLength(1);
    expect(startSvgs[0].classList.contains("amora-orb")).toBe(true);

    // 페이지 전체 SVG 도 센다 — 섹션이나 바닥글에 장식이 새로 붙으면 첫 화면 밖이라도 무게다.
    // 섹션의 장식은 오브뿐이다(시작 화면 · 아모라가 일하는 방식 · 마무리, 셋).
    const svgs = [...doc.querySelectorAll("svg")];
    expect(svgs.length, "오브 밖의 SVG 가 생겼거나 오브가 늘었다").toBeLessThanOrEqual(3);
    for (const svg of svgs) {
      expect(svg.classList.contains("amora-orb"), "오브가 아닌 장식 SVG 가 생겼다").toBe(true);
      expect(svg.querySelectorAll("image,script,foreignObject,a")).toHaveLength(0);
      expect(Buffer.byteLength(svg.outerHTML), "오브 마크업이 커졌다").toBeLessThanOrEqual(8 * 1024);
    }
  });

  it("draws only the bokeh photo and the listed example screens below the start screen", () => {
    // 그림은 보케 사진(시작 화면 · 마무리)과 카피에 적은 예시 화면뿐이다. 목록 밖의 그림이 끼면 운다.
    const doc = landingDocument();
    const allowed = new Set(["/images/amora/bokeh-blush.webp", ...LANDING_SHOTS.map((shot) => shot.src)]);
    const images = [...doc.querySelectorAll("img")];
    for (const img of images) {
      const src = decodeURIComponent(img.getAttribute("src") ?? "");
      expect([...allowed].some((path) => src.includes(path)), `목록 밖의 그림: ${src}`).toBe(true);
    }
    // 예시 화면은 카피에 적은 장 수만큼 그려진다(빠지면 섹션이 빈 틀이 된다).
    for (const shot of LANDING_SHOTS) {
      const drawn = images.filter((img) => decodeURIComponent(img.getAttribute("src") ?? "").includes(shot.src));
      expect(drawn, `${shot.src} 를 그리지 않는다`).toHaveLength(1);
      // 크기를 적어 내려야 그림이 오기 전에도 자리가 잡힌다(레이아웃이 밀리지 않는다).
      expect(drawn[0].getAttribute("width"), `${shot.src} 의 폭이 카피와 다르다`).toBe(String(shot.width));
      expect(drawn[0].getAttribute("height"), `${shot.src} 의 높이가 카피와 다르다`).toBe(String(shot.height));
    }
    expect(images.length, "그림이 늘었다").toBeLessThanOrEqual(2 + LANDING_SHOTS.length);
  });

  it("serves the example screens as small WebP files whose size matches the copy", () => {
    // 전화기 화면은 390×844 를 600px 폭으로, 넓은 화면은 1440×900 을 2160px 폭으로 줄인 WebP 다.
    // 카피의 폭·높이가 실제 파일과 다르면 그림이 늘어나거나 찌그러진다.
    expect(LANDING_SHOTS.length, "예시 화면 목록이 비었거나 달라졌다").toBe(4);
    for (const shot of LANDING_SHOTS) {
      const file = resolve(appRoot, "public" + shot.src);
      expect(existsSync(file), `${shot.src} 파일이 없다`).toBe(true);
      const buffer = readFileSync(file);
      const size = webpSize(buffer);
      expect(size, `${shot.src} 의 실제 크기가 카피와 다르다`).toEqual({ width: shot.width, height: shot.height });
      const budget = shot.width > 1000 ? WIDE_SHOT_BUDGET : PHONE_SHOT_BUDGET;
      expect(statSync(file).size, `${shot.src} 가 무겁다`).toBeLessThanOrEqual(budget);
    }
  });

  it("generates the landing social card from the page's own copy", () => {
    // 이전에는 정적 webp였고, 거기 "축하의 온도와 기준의 정밀함"이 구워져 있었다.
    // P5가 금지하는 정확성 보장 표현인데 이미지라서 어떤 카피 검사도 통과하지 않고
    // 남아 있었다. 카드를 생성물로 바꾸고, 문구 출처를 페이지와 하나로 묶는다.
    const card = readFileSync(resolve(appRoot, "src/app/landing/opengraph-image.tsx"), "utf8");

    expect(card).toContain("size = { width: 1200, height: 630 }");
    expect(card).toContain('contentType = "image/png"');
    // satori는 woff2를 읽지 못한다. ttf가 아니면 렌더가 통째로 실패한다.
    expect(card).toContain("Pretendard-Bold.ttf");

    // 2026-11-17: 카드 문구는 시작 화면과 같은 정본(`START_COPY`)에서 온다.
    expect(card).toContain('from "@hanbang/shared/invitation"');
    expect(card).toContain("START_COPY.headingLines");
    expect(card).toContain("START_COPY.body");
    // 정본을 읽는 척 하고 글자를 박아 두면 다시 갈라진다.
    for (const line of [...START_COPY.headingLines, START_COPY.body]) {
      expect(card, `공유 카드가 문구를 하드코딩했다: ${line}`).not.toContain(line);
    }

    // page.tsx가 images를 명시하면 파일 규약이 덮여 옛 카드가 되살아난다.
    const page = readFileSync(resolve(appRoot, "src/app/landing/page.tsx"), "utf8");
    expect(page).not.toMatch(/images:\s*\[/u);
    expect(page).not.toContain("landing-social-card");
  });

  it("no longer ships the retired card or the claim baked into it", () => {
    expect(existsSync(landingSocialCard), "P5 위반 문구가 구워진 카드가 남아 있다").toBe(false);

    // 주석은 벗기고 본다 — 왜 지웠는지 설명하려면 그 문구를 인용해야 한다.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[\t ]*\/\/.*$/gmu, "");
    for (const file of [
      "src/app/landing/page.tsx",
      "src/app/landing/opengraph-image.tsx",
      "src/components/landing/redesign/landingContent.ts",
    ]) {
      const source = stripComments(readFileSync(resolve(appRoot, file), "utf8"));
      expect(source, `${file}에 금지된 정밀함 주장이 있다`).not.toContain("기준의 정밀함");
    }
  });
});
