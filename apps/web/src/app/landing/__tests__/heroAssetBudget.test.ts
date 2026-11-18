// @vitest-environment jsdom

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";

import LandingPage from "../page";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

const appRoot = resolve(process.cwd());

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
    const doc = landingDocument();
    const main = doc.querySelector("main")!;
    expect(main.querySelectorAll("img"), "첫 화면 사진이 한 장이 아니다").toHaveLength(1);
    const svgs = [...main.querySelectorAll("svg")];
    expect(svgs, "첫 화면 SVG 가 오브 하나가 아니다").toHaveLength(1);
    const orb = svgs[0];
    expect(orb.classList.contains("amora-orb")).toBe(true);
    expect(orb.querySelectorAll("image,script,foreignObject,a")).toHaveLength(0);
    expect(Buffer.byteLength(orb.outerHTML), "오브 마크업이 커졌다").toBeLessThanOrEqual(8 * 1024);
    // 페이지 전체 SVG 도 센다 — 바닥글이나 머리줄에 장식이 새로 붙으면 첫 화면 밖이라도 무게다.
    expect(doc.querySelectorAll("svg"), "페이지에 오브 밖의 SVG 가 생겼다").toHaveLength(1);
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
