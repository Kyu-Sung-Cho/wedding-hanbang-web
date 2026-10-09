// @vitest-environment jsdom

import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LandingPage from "../page";
import LandingBloomLayer from "@/components/landing/redesign/LandingBloomLayer";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));


const appRoot = resolve(process.cwd());
const optimizedHero = resolve(
  appRoot,
  "public/images/amora-hero-bouquet-custom.webp",
);
const bouquetSourceFiles = [
  "src/app/(community)/community/cohort/page.tsx",
  "src/app/(community)/community/cohort/[id]/page.tsx",
];
/**
 * 첫 화면 자산 예산은 실제 렌더되는 SVG 마크업을 센다.
 * 모바일 가지·데스크톱 좌우 가지와 마지막 다크 밴드의 가지를 모두 포함한다.
 * 장식 데이터 파일과 렌더링 HTML/gzip 각각에 상한을 둔다.
 * 커뮤니티의 공유 WebP 자산과 랜딩의 OG 카드 계약도 유지한다.
 */
const landingBloom = resolve(
  appRoot,
  "src/components/landing/redesign/LandingBloom.tsx",
);
const landingBloomLayer = resolve(
  appRoot,
  "src/components/landing/redesign/LandingBloomLayer.tsx",
);
const transformationHero = resolve(
  appRoot,
  "src/components/landing/redesign/TransformationHero.tsx",
);
const landingSocialCard = resolve(
  appRoot,
  "public/images/landing-social-card.webp",
);

describe("hero image performance budget", () => {
  it("serves the shared bouquet hero as a bounded WebP asset", () => {
    expect(statSync(optimizedHero).size).toBeLessThanOrEqual(350 * 1024);

    for (const sourceFile of bouquetSourceFiles) {
      const source = readFileSync(resolve(appRoot, sourceFile), "utf8");
      expect(source).toContain("/images/amora-hero-bouquet-custom.webp");
      expect(source).not.toContain("/images/amora-hero-bouquet-custom.png");
    }
  });

  it("bounds the SVG markup actually rendered by the landing", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    const decorations = [...doc.querySelectorAll("svg.pointer-events-none")];
    expect(decorations).toHaveLength(4);
    const layer = new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(LandingBloomLayer)),
      "text/html",
    );
    expect(layer.querySelectorAll("svg")).toHaveLength(3);
    const mobileBranches = [...layer.querySelectorAll("svg")]
      .filter((svg) => !svg.classList.contains("hidden"));
    expect(mobileBranches).toHaveLength(1);
    expect(mobileBranches[0].getAttribute("viewBox")).toBe("0 0 250 200");
    expect(doc.getElementById("trust")?.querySelectorAll("svg.pointer-events-none")).toHaveLength(1);

    for (const svg of decorations) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.getAttribute("class")).toMatch(/(?:^|\s)w-\[\d+px\](?:\s|$)/u);
      expect(svg.querySelectorAll("circle")).toHaveLength(3);
      expect(svg.querySelectorAll("ellipse")).toHaveLength(15);
      expect(svg.querySelectorAll("image,script,foreignObject,a")).toHaveLength(0);
      expect(Buffer.byteLength(svg.outerHTML)).toBeLessThanOrEqual(48 * 1024);
    }

    // 데이터 배열·공유 함수도 파일 예산에 포함하고, 반복 배치는 실제 HTML 횟수로 센다.
    expect(statSync(landingBloom).size).toBeLessThanOrEqual(96 * 1024);
    const shipped = decorations.map((svg) => svg.outerHTML).join("");
    expect(Buffer.byteLength(shipped)).toBeLessThanOrEqual(160 * 1024);
    expect(gzipSync(shipped).byteLength).toBeLessThanOrEqual(40 * 1024);
    const hero = doc.getElementById("hero-title")?.closest("section");
    expect(hero).toBeTruthy();
    expect(hero?.querySelectorAll("img,picture,video,image")).toHaveLength(0);
    for (const file of [transformationHero, landingBloomLayer]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("amora-hero-bouquet-custom");
      expect(source).not.toContain("radial-gradient");
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

    // 카드 문구는 반드시 페이지와 같은 출처에서 온다 — 하드코딩하면 다시 갈라진다.
    expect(card).toContain("landingContent");
    expect(card).toContain("landingContent.hero.title");
    expect(card).toContain("landingContent.hero.shareDescription");

    // page.tsx가 images를 명시하면 파일 규약이 덮여 옛 카드가 되살아난다.
    const page = readFileSync(resolve(appRoot, "src/app/landing/page.tsx"), "utf8");
    expect(page).not.toMatch(/images:\s*\[/u);
    expect(page).not.toContain("landing-social-card");
  });

  it("no longer ships the retired card or the claim baked into it", () => {
    expect(existsSync(landingSocialCard), "P5 위반 문구가 구워진 카드가 남아 있다").toBe(false);

    // 주석은 벗기고 본다 — 왜 지웠는지 설명하려면 그 문구를 인용해야 하는데,
    // 자기 설명에 걸려 넘어지는 가드는 가드가 아니다. 실제 렌더에 닿는 코드만 본다.
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
