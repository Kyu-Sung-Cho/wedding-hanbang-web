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
/**
 * 첫 화면 자산.
 *
 * 2026-08-27 개편 전에는 `public/images/wedding-celebration-hero.webp`(122KB)를
 * `fill`로 깔고 그 위에 그라디언트를 덮은 사진이었다. 지금 첫 화면에 실리는 것은
 * `LandingBloom`의 `BouquetCorner` 하나뿐이다(`TransformationHero.tsx:39`) —
 * 파일이 아니라 인라인 SVG 마크업이라 예산도 파일 크기가 아니라 마크업 크기로 잰다.
 *
 * ⚠️ 없어진 단언: `statSync(public/images/wedding-celebration-hero.webp) <= 180KB`.
 * 그 파일은 디스크에 남아 있지만 랜딩이 더 이상 부르지 않는다 — 지금 그 이미지를
 * 부르는 곳은 어디서도 렌더되지 않는 `components/landing/CelebrationHero.tsx`
 * 하나뿐이다(자기 테스트가 유일한 호출자). 첫 화면 예산을 그 파일 크기로 재면
 * 첫 화면과 무관한 숫자를 지키게 되므로 대상을 위 둘로 옮겼다.
 */
const landingBloom = resolve(
  appRoot,
  "src/components/landing/redesign/LandingBloom.tsx",
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

  it("serves one bounded first-view decoration and no raster hero", () => {
    // 예산의 의도는 그대로다 — **첫 화면이 내려받는 바이트에 천장이 있는가.**
    // 자산이 사진에서 인라인 SVG로 바뀌었으니(2026-08-27 개편) 재는 대상만 옮긴다.
    // `statSync(wedding-celebration-hero.webp) <= 180KB`가 지키던 파일은 이제 이
    // 화면에 쓰이지 않는다 — 자세한 건 아래 removed 주석.
    //
    // LandingBloom은 서버 컴포넌트라 파일 전체가 아니라 **렌더된 조각의 마크업만**
    // HTML로 나간다. 그래서 첫 화면 몫은 `BouquetCorner` 하나다.
    const bloom = readFileSync(landingBloom, "utf8");
    const corner = bloom.slice(
      bloom.indexOf("export function BouquetCorner"),
      bloom.indexOf("export function BloomSprig"),
    );
    expect(corner.length, "BouquetCorner를 잘라내지 못했다 — 파일 구조가 바뀌었다")
      .toBeGreaterThan(0);
    expect(
      Buffer.byteLength(corner, "utf8"),
      "첫 화면 장식이 예산을 넘었다 — landing-canvas/bouquet.py에서 경로 수를 줄인다",
    ).toBeLessThanOrEqual(48 * 1024);

    // 세 조각(부케·가지·화환)이 전부 랜딩 한 장에 실린다. 첫 화면 밖이라 천장은 더
    // 느슨하지만, 그림 파일이 없다는 이유로 무제한이 되지는 않는다. 이 파일은
    // `bake-bloom.py`가 구워 내므로 손이 아니라 스크립트가 예산을 넘긴다.
    expect(
      Buffer.byteLength(bloom, "utf8"),
      "랜딩 장식 전체가 예산을 넘었다",
    ).toBeLessThanOrEqual(96 * 1024);

    const source = readFileSync(transformationHero, "utf8");

    // 옛 계약도 "히어로 자산은 한 장"이었다(`match(...).toHaveLength(1)`).
    expect(source.match(/<BouquetCorner\b/gu)).toHaveLength(1);
    for (const extra of ["<BloomSprig", "<BloomGarland"]) {
      expect(source, `첫 화면에 장식을 더 얹었다(${extra})`).not.toContain(extra);
    }

    // `sizes="(min-width: 1024px) 58vw, 100vw"`가 지키던 것은 "첫 화면이 보이지 않는
    // 바이트를 내려받지 않는다"였다. 이미지가 없으면 그 속성은 성립하지 않으므로
    // 이미지 자체를 막는다 — 래스터가 돌아오면 예산 계약이 통째로 되돌아간다.
    for (const raster of [".webp", ".png", ".jpg", "next/image", "<img"]) {
      expect(source, `첫 화면이 다시 이미지를 내려받는다(${raster})`).not.toContain(raster);
    }
    // 공유 부케 사진은 커뮤니티 것이다. 첫 화면으로 끌어오면 350KB가 얹힌다.
    expect(source).not.toContain("amora-hero-bouquet-custom");
    // 그라디언트로 그림을 흉내내면 자산 예산 밖에서 페인트 비용이 샌다.
    expect(source).not.toContain("radial-gradient");

    // `lg:min-h-[min(720px,calc(100svh-4rem))]`가 지키던 것: 첫 화면 자산이 자리를
    // 미리 잡아 본문을 밀지 않는 것. 인라인 SVG에는 고유 크기가 없어서 이 일을
    // 클래스가 한다 — h-/w-를 지우면 부케가 부모 폭까지 늘어나며 H1을 덮는다
    // (768px 실측에서 293x171px 겹침이 실제로 났다).
    expect(source, "부케에 높이 클래스가 없다").toMatch(/<BouquetCorner[^>]*\sh-\[/u);
    expect(source, "부케에 폭 클래스가 없다").toMatch(/<BouquetCorner[^>]*\sw-\[/u);
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
