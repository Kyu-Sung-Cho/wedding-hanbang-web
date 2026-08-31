// @vitest-environment node

import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
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

  it("serves one bounded first-view decoration and no raster hero", () => {
    // 예산의 의도는 그대로다 — **첫 화면이 내려받는 바이트에 천장이 있는가.**
    // 자산이 사진에서 인라인 SVG로 바뀌었으니(2026-08-27 개편) 재는 대상만 옮긴다.
    // `statSync(wedding-celebration-hero.webp) <= 180KB`가 지키던 파일은 이제 이
    // 화면에 쓰이지 않는다 — 자세한 건 아래 removed 주석.
    //
    // 2026-08-29: 장식이 히어로 안에서 **페이지 전역 레이어**(`LandingBloomLayer`)로
    // 옮겨졌다. 정본 시안의 `.bq-*` 배치가 화면 위아래 다섯 자리에 꽃을 두기 때문이다.
    // 그래서 "히어로가 한 조각만 쓴다"는 옛 형태로는 아무것도 재지 못한다 —
    // 히어로에는 이제 `<BouquetCorner` 가 0개이고, 그 단언은 구조가 바뀐 것을
    // 통과가 아니라 **null 오류**로 알려 줬다.
    //
    // 재는 대상을 **첫 HTML 이 싣는 장식 전부**로 옮긴다. 레이어는 서버 컴포넌트라
    // 다섯 조각의 마크업이 전부 초기 HTML 로 나간다.
    const bloom = readFileSync(landingBloom, "utf8");
    const bounds = [...bloom.matchAll(/export function (\w+)/gu)];
    expect(bounds.length, "장식 파일에서 조각을 못 찾았다 — 구조가 바뀌었다")
      .toBeGreaterThanOrEqual(3);
    const piece: Record<string, string> = {};
    bounds.forEach((match, i) => {
      piece[match[1]] = bloom.slice(match.index, bounds[i + 1]?.index ?? bloom.length);
    });

    const layer = readFileSync(landingBloomLayer, "utf8");
    // 같은 조각을 두 번 그리면 두 번 실린다. 그래서 **쓰인 횟수만큼** 센다.
    // 레이어가 각 조각을 몇 번 그리는지 센다. 태그 이름을 **리터럴 정규식 하나로**
    // 뽑아 이름별로 합산한다 — 이름을 문자열에 끼워 `new RegExp` 를 만들면
    // 템플릿 리터럴이 역슬래시 b 를 백스페이스 문자로 바꿔 버려 개수가 조용히 0이 된다
    // (2026-08-29에 실제로 그랬고, 그 상태로도 "장식이 예산 안"이라 초록불이었다).
    const drawn = new Map<string, number>();
    for (const [, tag] of layer.matchAll(/<([A-Z][A-Za-z0-9]*)/gu)) {
      drawn.set(tag, (drawn.get(tag) ?? 0) + 1);
    }
    let shipped = "";
    for (const [name, body] of Object.entries(piece)) {
      const used = drawn.get(name) ?? 0;
      shipped += body.repeat(used);
    }
    expect(shipped.length, "레이어가 장식을 하나도 그리지 않는다").toBeGreaterThan(0);

    // 조각 하나의 천장은 그대로 48KB — 하나가 부풀면 다섯 자리가 같이 부푼다.
    for (const [name, body] of Object.entries(piece)) {
      expect(
        Buffer.byteLength(body, "utf8"),
        `${name} 이 조각 예산을 넘었다 — landing-canvas/bouquet.py에서 경로 수를 줄인다`,
      ).toBeLessThanOrEqual(48 * 1024);
    }

    // ⚠️ 파일 전체 천장(96KB)을 되살렸다. 개편 때 "그리는 것만 세면 된다"고 지웠는데,
    // 그러면 **레이어가 안 그리는 조각은 아무 제한도 안 받는다.** 조각을 열 개 넣고
    // 하나만 그려도 위 검사들은 전부 통과한다. 그 파일은 `bake-bloom.py` 가 구워
    // 내므로 손이 아니라 스크립트가 예산을 넘긴다 — 넘으면 경로 수를 줄여야 한다.
    expect(
      Buffer.byteLength(bloom, "utf8"),
      "랜딩 장식 파일 전체가 예산을 넘었다",
    ).toBeLessThanOrEqual(96 * 1024);

    // 첫 화면이 내려받는 총량. 이 계약이 원래 지키던 것은 사진 한 장 180KB 였고,
    // 다섯 조각을 합쳐도 **gzip 30.8KB** 라 그보다 싸다(2026-08-29 실측).
    // 원본도 함께 재는 이유: gzip 은 복제를 거의 공짜로 만들어서 gzip 만 보면 같은
    // 조각을 스무 개 얹어도 안 걸린다. 파싱 비용은 원본 크기를 따라간다.
    expect(
      Buffer.byteLength(shipped, "utf8"),
      "첫 화면 장식 원본이 예산을 넘었다 — 자리를 줄이거나 경로 수를 줄인다",
    ).toBeLessThanOrEqual(160 * 1024);
    expect(
      gzipSync(Buffer.from(shipped, "utf8")).byteLength,
      "첫 화면 장식이 전송 예산을 넘었다",
    ).toBeLessThanOrEqual(40 * 1024);

    // 장식은 **꽃뿐**이다. 래스터가 돌아오면 예산 계약이 통째로 되돌아간다.
    const source = readFileSync(transformationHero, "utf8");
    for (const raster of [".webp", ".png", ".jpg", "next/image", "<img"]) {
      for (const [where, text] of [["히어로", source], ["장식 레이어", layer]] as const) {
        expect(text, `${where}가 다시 이미지를 내려받는다(${raster})`).not.toContain(raster);
      }
    }
    // 공유 부케 사진은 커뮤니티 것이다. 첫 화면으로 끌어오면 350KB가 얹힌다.
    expect(source).not.toContain("amora-hero-bouquet-custom");
    // 그라디언트로 그림을 흉내내면 자산 예산 밖에서 페인트 비용이 샌다.
    expect(source).not.toContain("radial-gradient");

    // 인라인 SVG에는 고유 크기가 없다. 폭 클래스를 지우면 부모 폭까지 늘어나며
    // 본문을 덮는다(768px 실측에서 293x171px 겹침이 실제로 났다). 레이어의
    // **모든** 자리가 폭을 갖는지 본다 — 한 자리만 보면 나머지가 빠져나간다.
    const placements = [...layer.matchAll(/<(?:BouquetCorner|BloomSprig|BloomGarland)\b[^>]*/gu)];
    expect(placements.length, "레이어에 배치가 없다").toBeGreaterThanOrEqual(3);
    for (const [markup] of placements) {
      expect(markup, `폭 클래스가 없는 배치가 있다: ${markup.slice(0, 60)}`)
        .toMatch(/\sw-(?:\[|full)/u);
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
