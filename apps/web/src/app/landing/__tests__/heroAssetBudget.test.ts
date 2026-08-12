// @vitest-environment node

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const optimizedHero = resolve(
  appRoot,
  "public/images/amora-hero-bouquet-custom.webp",
);
const bouquetSourceFiles = [
  "src/app/(community)/community/cohort/page.tsx",
  "src/app/(community)/community/cohort/[id]/page.tsx",
];
const celebrationHero = resolve(
  appRoot,
  "public/images/wedding-celebration-hero.webp",
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

  it("serves one optimized celebration image within the first-view budget", () => {
    expect(statSync(celebrationHero).size).toBeLessThanOrEqual(180 * 1024);

    const source = readFileSync(
      resolve(appRoot, "src/components/landing/redesign/TransformationHero.tsx"),
      "utf8",
    );
    expect(source).toContain("/images/wedding-celebration-hero.webp");
    expect(source).toContain('sizes="(min-width: 1024px) 58vw, 100vw"');
    expect(source.match(/src="\/images\/wedding-celebration-hero\.webp"/g)).toHaveLength(1);
    expect(source).toContain("lg:min-h-[min(720px,calc(100svh-4rem))]");
    expect(source).not.toContain("radial-gradient");
    expect(source).not.toContain("amora-hero-bouquet-custom");

    const nextConfig = readFileSync(resolve(appRoot, "next.config.ts"), "utf8");
    expect(nextConfig).toMatch(/qualities:\s*\[[^\]]*50[^\]]*\]/u);
  });

  it("generates the landing social card from the page's own copy", () => {
    // 이전에는 정적 webp였고, 거기 "축하의 온도와 기준의 정밀함"이 구워져 있었다.
    // P5가 금지하는 정확성 보장 표현인데 이미지라서 어떤 카피 검사도 통과하지 않고
    // 남아 있었다. 카드를 생성물로 바꾸고, 문구 출처를 페이지와 하나로 묶는다.
    const card = readFileSync(resolve(appRoot, "src/app/landing/opengraph-image.tsx"), "utf8");

    expect(card).toContain("size = { width: 1200, height: 630 }");
    expect(card).toContain('contentType = "image/png"');
    // satori는 woff2를 읽지 못한다. ttf가 아니면 렌더가 통째로 실패한다.
    expect(card).toContain("Paperlogy-7Bold.ttf");

    // 카드 문구는 반드시 페이지와 같은 출처에서 온다 — 하드코딩하면 다시 갈라진다.
    expect(card).toContain("landingContent");
    expect(card).toContain("landingContent.hero.title");
    expect(card).toContain("landingContent.hero.body");

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
