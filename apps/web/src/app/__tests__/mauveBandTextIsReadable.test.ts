// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { colors } from "@hanbang/design-tokens";

/**
 * 모브 채움 위의 글자가 읽히는가.
 *
 * ## 무엇이 있었나
 *
 * 2026-09-16 `--hb-primary` 가 먹색 `#26251F` 에서 `rose[600]` `#8F6662` 로 옮겨졌다(#411).
 * 먹색 위에서 반투명 흰 글자는 넉넉했다(white/65 = 7.3:1). 모브는 훨씬 밝아서 **같은
 * 클래스가 3.09:1 로 무너졌다.** 공시 가격·커뮤니티 푸터, 랜딩 푸터, 시작 안내 띠가
 * 그렇게 됐고, 앱 웹뷰로 여는 화면이라 파운더가 앱에서 "버튼 글자 잘 안 보여"라고 봤다.
 *
 * 흰 글자는 불투명일 때만 모브 위에서 4.5:1 을 넘는다(4.95). 그래서 이 띠들에서는
 * 읽는 글자에 투명도를 쓰지 않는다. 아이콘은 3:1 기준이라 여기서 보지 않는다.
 */

function luminance(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`6자리 색이어야 한다: ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** 불투명 바탕 위에 알파를 섞은 색. */
function over(fg: string, alpha: number, bg: string) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(fg, i) * alpha + channel(bg, i) * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** 바탕 전체가 `--hb-primary`(모브)인 띠·푸터. 이 안의 읽는 글자는 불투명이어야 한다. */
const MAUVE_BANDS = [
  "src/app/price/layout.tsx",
  "src/app/(community)/layout.tsx",
  "src/components/landing/Footer.tsx",
  "src/components/community/StartHereClient.tsx",
];

describe("모브 채움 위의 글자", () => {
  it("불투명 흰 글자만 기준을 넘고, 반투명 흰 글자는 무너진다", () => {
    const mauve = colors.rose[600];
    expect(contrast("#FFFFFF", mauve)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.paper.card, mauve)).toBeGreaterThanOrEqual(4.5);
    // 이 띠들에 있던 값들 — 하나라도 통과하면 이 검사의 전제가 틀린 것이다.
    for (const alpha of [0.55, 0.6, 0.65, 0.7, 0.8]) {
      expect(contrast(over("#FFFFFF", alpha, mauve), mauve)).toBeLessThan(4.5);
    }
  });

  it.each(MAUVE_BANDS)("%s 는 읽는 글자에 반투명 흰색을 쓰지 않는다", (path) => {
    const source = read(path);
    const translucentText = source.match(/\btext-white\/\d+|\btext-\[var\(--hb-on-primary\)\]\/\d+/g) ?? [];
    expect(translucentText).toEqual([]);
  });

  it("띠·푸터 바탕이 여전히 모브다 — 바탕이 바뀌면 이 검사를 다시 세워야 한다", () => {
    expect(read("src/app/price/layout.tsx")).toContain("bg-[var(--hb-primary)]");
    expect(read("src/components/landing/Footer.tsx")).toContain('<footer className="bg-[var(--hb-primary)]');
    expect(read("src/components/community/StartHereClient.tsx")).toContain(
      '<section className="bg-[var(--hb-primary)] text-white" aria-labelledby="start-here-title">',
    );
  });

  it("공시 가격의 선택된 분야 칩 개수는 연한 선택 면 위에서 선택 글자색을 쓴다", () => {
    // 선택 면은 rose.pale 이라 흰 글자(1.21:1)는 사라진다.
    expect(contrast(colors.rose[700], colors.rose.pale)).toBeGreaterThanOrEqual(4.5);
    const explorer = read("src/components/price/PriceExplorer.tsx");
    expect(explorer).toContain('value === category ? "text-[var(--hb-selected-text)]"');
    expect(explorer).not.toMatch(/value === category \? "text-white\/\d+"/);
  });

  it("채운 모브 선택 칩의 보조 글자도 불투명 흰색이다", () => {
    const landing = read("src/components/community/CommunityLandingClient.tsx");
    expect(landing).not.toMatch(/active \? "text-white\/\d+"/);
    const cohort = read("src/app/(community)/community/cohort/[id]/page.tsx");
    expect(cohort).not.toMatch(/active \? "text-white\/\d+"/);
    const court = read("src/app/(community)/community/wedding-court/WeddingCourtClient.tsx");
    expect(court).not.toMatch(/selected \? "text-white\/\d+"/);
    expect(court).not.toContain("bg-[#a77b74] text-white");
  });
});
