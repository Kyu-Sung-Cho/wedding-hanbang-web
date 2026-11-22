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
  "src/components/start-here/StartHereClient.tsx",
  // 2026-09-17 두 번째 측정에서 더 찾은 모브 면들.
  "src/components/common/AiNoticeFooter.tsx",
  "src/components/landing/PreparationOutcomePreview.tsx",
  "src/components/app/TodayOneCard.tsx",
  "src/components/community/CohortCard.tsx",
];

/** 모브 위에서 무너지는 밝은 장식색(글자로 쓰일 때). */
const PALE_ACCENTS_ON_MAUVE = {
  "text-rose-light": colors.rose.light,
  "text-[#E2D3C8]": colors.gold.light,
  "text-[#F7F1E8]": colors.ivory[100],
  "text-[#C7D1C2]": colors.sage.pale,
  "text-[#B89785]": colors.gold.DEFAULT,
  "text-[#878680]": "#878680",
  "text-[var(--hb-text-muted)]": colors.paper.inkFaint,
};

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

  it("모브 면의 작은 글자에 밝은 장식색·어두운 잉크를 쓰지 않는다", () => {
    for (const [cls, hex] of Object.entries(PALE_ACCENTS_ON_MAUVE)) {
      expect(contrast(hex, colors.rose[600]), cls).toBeLessThan(4.5);
    }
    // 시작 안내 머리글의 `text-[#E2D3C8]` 은 40px 이상 제목이라 3:1 기준으로 남긴다.
    expect(contrast(colors.gold.light, colors.rose[600])).toBeGreaterThanOrEqual(3);
    const cohort = read("src/components/community/CohortCard.tsx");
    const scopes: Array<[string, string, string[]]> = [
      ["src/components/landing/Footer.tsx", read("src/components/landing/Footer.tsx"), []],
      // 아이콘(3:1)은 밝은 샴페인을 유지한다 — 아래에서 그 한 곳뿐임을 따로 본다.
      ["src/components/landing/PreparationOutcomePreview.tsx", read("src/components/landing/PreparationOutcomePreview.tsx"), ["text-[#E2D3C8]"]],
      // 오늘의 한 가지 카드 본문(흰 면)은 잉크 글자를 쓴다 — 모브는 머리 띠뿐이다.
      ["src/components/app/TodayOneCard.tsx", read("src/components/app/TodayOneCard.tsx"), ["text-[var(--hb-text-muted)]"]],
      // 방이 없을 때의 흰 카드는 잉크 글자를 쓴다. 모브 카드(방 목록)만 본다.
      ["CohortCard (모브 카드)", cohort.slice(cohort.indexOf("bg-[var(--hb-primary)] p-5")), []],
    ];
    for (const [label, source, allowed] of scopes) {
      const found = Object.keys(PALE_ACCENTS_ON_MAUVE).filter((cls) =>
        new RegExp(`(^|[\\s"'\`])${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s"'\`]|$)`, "m").test(source),
      );
      expect(found.filter((cls) => !allowed.includes(cls)), label).toEqual([]);
    }
    expect(cohort.indexOf("bg-[var(--hb-primary)] p-5")).toBeGreaterThan(0);
    const preview = read("src/components/landing/PreparationOutcomePreview.tsx");
    expect(preview.match(/text-\[#E2D3C8\]/g)).toHaveLength(1);
    expect(preview).toContain('<MessageCircle className="h-5 w-5 text-[#E2D3C8]" aria-hidden="true" />');
  });

  it("AI 고지의 어두운 변형: ⓘ 칩은 눌림 모브 위 흰 글리프이고, 호버는 색이 아니라 밑줄이다", () => {
    const tinted = over("#FFFFFF", 0.1, colors.rose[600]);
    expect(contrast("#FFFFFF", tinted)).toBeLessThan(4.5);
    expect(contrast("#FFFFFF", colors.rose[700])).toBeGreaterThanOrEqual(4.5);
    const footer = read("src/components/common/AiNoticeFooter.tsx");
    expect(footer).toContain('? "bg-[var(--hb-primary-hover)] text-[var(--hb-on-primary)]"');
    expect(footer).not.toMatch(/isDark\s*\?\s*"bg-white\/\d+/);
    expect(footer).toContain('const linkHoverCls = isDark ? "hover:decoration-2"');
    // 불투명 흰 글자 위에서 `hover:text-white` 는 아무것도 바꾸지 않는다.
    for (const path of ["src/components/common/AiNoticeFooter.tsx", "src/components/landing/Footer.tsx"]) {
      expect(read(path), path).not.toMatch(/hover:text-white\b/);
    }
  });

  it("띠·푸터 바탕이 여전히 모브다 — 바탕이 바뀌면 이 검사를 다시 세워야 한다", () => {
    expect(read("src/app/price/layout.tsx")).toContain("bg-[var(--hb-primary)]");
    expect(read("src/components/landing/Footer.tsx")).toContain('<footer className="bg-[var(--hb-primary)]');
    expect(read("src/components/start-here/StartHereClient.tsx")).toContain(
      '<section className="bg-[var(--hb-primary)] text-white" aria-labelledby="start-here-title">',
    );
    expect(read("src/components/landing/Footer.tsx")).toContain("<AiNoticeFooter variant=\"dark\" />");
    expect(read("src/components/landing/PreparationOutcomePreview.tsx")).toContain(
      '<div className="bg-[var(--hb-primary)] px-5 py-7 text-white',
    );
    expect(read("src/components/app/TodayOneCard.tsx")).toContain('<div className="bg-[var(--hb-primary)] px-5 py-5 text-white');
    expect(read("src/components/community/CohortCard.tsx")).toMatch(/border-\[#F0EFED\] bg-\[var\(--hb-primary\)\] p-5/);
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
