// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { colors } from "@hanbang/design-tokens";

/**
 * 종이 지면 위의 읽는 글자와, 선 하나로만 구분되는 컨트롤의 경계.
 *
 * ## 무엇이 있었나
 *
 * #417 은 버튼·선택 글자·모브 띠만 고쳤다. 2026-09-17 같은 날 요소마다 실제 부모 바탕을
 * 찾아(반투명은 부모 위에 섞어) 다시 재 보니, 웹에 읽는 글자 약 340곳이 4.5:1 아래였다.
 * 대부분 **글자로 쓸 수 없는 색이 글자로 쓰인** 경우였다 — 샴페인 `#C4967E` 2.62,
 * 골드 `#B89785` 2.69, 회색 `#878680` 3.65, Tailwind 기본 `red-500` 3.81, `amber-500` 2.13.
 *
 * 글자는 잉크 단계(`--hb-text-muted`)·`rose-700`·`danger-700`·펜(`--hb-accent`)·
 * 테이프 잉크(`--color-paper-tape-ink`, 골드·경고)로 옮겼다. 토큰 값은 그대로다.
 *
 * 선 버튼의 경계도 같은 날 재었다. `border-[var(--hb-primary)]/12~35` 는 흰 면에서
 * 1.1~1.6:1 이라 "누를 수 있는 것" 으로 읽히지 않았다(WCAG 1.4.11 은 3:1).
 * DESIGN.md 가 이미 정한 `--color-paper-outline` 으로 옮겼다.
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
function over(fg: string, alpha: number, bg: string) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(fg, i) * alpha + channel(bg, i) * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

const webRoot = resolve(__dirname, "../../..");
const srcRoot = join(webRoot, "src");

/** 운영에서 그려지지 않는 파일. 이유가 없으면 여기 넣지 않는다. */
const NOT_RENDERED_IN_PRODUCTION = new Set([
  // `NODE_ENV !== "production"` 일 때만 커뮤니티 첫 화면이 대신 그린다.
  "components/community/CommunityAcquisitionPrototype.tsx",
]);

/** 주석을 걷어낸 웹 화면 소스 전부. 왜 바꿨는지 적은 주석이 검사에 걸리지 않게. */
function productSources() {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      // `.ts` 도 본다 — 카테고리 배지처럼 클래스를 상수 파일에 두는 화면이 있다.
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || /\.d\.ts$/.test(name)) continue;
      const rel = relative(srcRoot, path).replace(/\\/g, "/");
      if (NOT_RENDERED_IN_PRODUCTION.has(rel)) continue;
      const code = ts.transpileModule(readFileSync(path, "utf8"), {
        fileName: name,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
      }).outputText;
      out.push([rel, code]);
    }
  };
  walk(srcRoot);
  // 경로가 틀어지면 이 검사는 빈 목록으로 조용히 통과한다.
  expect(out.length).toBeGreaterThan(300);
  return out;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * 글자로 쓰면 종이 지면(`paper.sheet`)에서 4.5:1 에 못 미치는 색.
 * Tailwind 기본 팔레트 값은 v4 `theme.css` 의 oklch 를 sRGB 로 옮긴 값이다.
 */
const UNREADABLE_TEXT: Record<string, string> = {
  "text-[#C4967E]": "#C4967E",
  "text-[#B89785]": colors.gold.DEFAULT,
  "text-gold": colors.gold.DEFAULT,
  "text-[var(--color-gold)]": colors.gold.DEFAULT,
  "text-[#A77B74]": colors.rose[500],
  // `text-[var(--amora-rose)]` 는 여기 없다 — 워크스페이스에서 남은 셋은 전부 16px 아이콘(3:1)이다.
  "text-[#9A6B62]": "#9A6B62",
  "text-[#D95F5F]": colors.danger,
  "text-[#d95f5f]": colors.danger,
  "text-[#D85A5A]": "#D85A5A",
  "text-[#878680]": "#878680",
  "text-[#9a9188]": "#9A9188",
  "text-[#8E857C]": "#8E857C",
  "text-[#8b8175]": "#8B8175",
  "text-[#8b857c]": "#8B857C",
  "text-[#C8BDB6]": "#C8BDB6",
  "text-[#F0EFED]": "#F0EFED",
  "text-red-400": "#FF6467",
  "text-red-500": "#FB2C36",
  "text-amber-500": "#FE9A00",
  "text-emerald-500": "#00BC7D",
  "text-blue-400": "#51A2FF",
};

/**
 * 밝은 종이가 아니라 **어두운 면** 위에 있어서 통과하는 자리. 면이 바뀌면 예외도 사라져야 한다.
 */
const ON_DARK_SURFACE = [
  {
    file: "components/app/budget/BudgetContent.tsx",
    cls: "text-[var(--color-gold)]",
    hex: colors.gold.DEFAULT,
    // 예산 요약 띠는 의도적으로 먹색이다(#416 — 모브로 옮기면 라벨이 2.32 로 무너진다).
    surfaceClass: "bg-[var(--amora-ink)] px-[19px]",
    surfaceHex: colors.paper.ink,
  },
];

describe("종이 지면 위의 읽는 글자", () => {
  it("금지 목록의 색은 정말 종이에서 무너지고, 옮겨 간 색은 세 지면 모두에서 통과한다", () => {
    for (const [cls, hex] of Object.entries(UNREADABLE_TEXT)) {
      expect(contrast(hex, colors.paper.sheet), cls).toBeLessThan(4.5);
    }
    const surfaces = { sheet: colors.paper.sheet, card: colors.paper.card, tint: colors.paper.tint };
    for (const [name, hex] of Object.entries({
      "--hb-text-muted": colors.paper.inkFaint,
      "rose-700": colors.rose[700],
      "danger-700": colors.dangerDeep,
      "--hb-accent": colors.paper.pen,
      "--color-paper-tape-ink": colors.paper.tapeInk,
      "--hb-success": colors.sage.deep,
      "noir-800": colors.noir[800],
    })) {
      for (const [surface, bg] of Object.entries(surfaces)) {
        expect(contrast(hex, bg), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("화면 소스에 그 색이 글자(호버·자리표시 포함)로 남아 있지 않다", () => {
    const pattern = new RegExp(
      `(?<![\\w\\[-])(?:[\\w-]+:)*(?:${Object.keys(UNREADABLE_TEXT).map(escape).join("|")})!?(?![\\w/\\[-])`,
      "g",
    );
    const hits: string[] = [];
    for (const [file, code] of productSources()) {
      for (const match of code.matchAll(pattern)) {
        const allowed = ON_DARK_SURFACE.some((entry) => entry.file === file && entry.cls === match[0]);
        if (!allowed) hits.push(`${file}: ${match[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("예외로 둔 글자는 여전히 어두운 면 위에 있다", () => {
    for (const entry of ON_DARK_SURFACE) {
      const source = readFileSync(join(srcRoot, entry.file), "utf8");
      expect(source, entry.file).toContain(entry.surfaceClass);
      expect(contrast(entry.hex, entry.surfaceHex), entry.file).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("반투명 잉크 글자는 알파를 섞은 뒤에도 세 지면에서 4.5:1 을 넘는다", () => {
    const inks: Record<string, string> = {
      strong: colors.paper.ink,
      body: colors.paper.inkSoft,
      muted: colors.paper.inkFaint,
    };
    // 전제: 잉크 60% 는 무너지고 불투명 muted 는 통과한다.
    expect(contrast(over(colors.paper.ink, 0.6, colors.paper.sheet), colors.paper.sheet)).toBeLessThan(4.5);
    expect(contrast(colors.paper.inkFaint, colors.paper.tint)).toBeGreaterThanOrEqual(4.5);
    const pattern = /(?<![\w[-])(?:[\w-]+:)*text-\[var\(--hb-text-(strong|body|muted)\)\]\/(\d+)/g;
    const hits: string[] = [];
    let seen = 0;
    for (const [file, code] of productSources()) {
      for (const match of code.matchAll(pattern)) {
        seen += 1;
        const alpha = Number(match[2]) / 100;
        const worst = Math.min(
          ...[colors.paper.sheet, colors.paper.card, colors.paper.tint].map((bg) =>
            contrast(over(inks[match[1]], alpha, bg), bg),
          ),
        );
        if (worst < 4.5) hits.push(`${file}: ${match[0]} (${worst.toFixed(2)})`);
      }
    }
    // 반투명 잉크가 아예 안 보이면 패턴이 고장 난 것이다(지금은 70~85% 가 수십 곳 있다).
    expect(seen).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});

describe("색이 칠해진 머리·영역 위의 글자", () => {
  it("견적 항목 체크 머리는 모브 채움 위 불투명 흰 글자다", () => {
    // 옛 머리는 샴페인 `#C4967E` 에서 시작해 흰 글자 2.62, 흰 70% 는 2.03 이었다.
    expect(contrast("#FFFFFF", "#C4967E")).toBeLessThan(3);
    expect(contrast("#FFFFFF", colors.rose[600])).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#FFFFFF", colors.rose[700])).toBeGreaterThanOrEqual(4.5);
    const quote = readFileSync(join(srcRoot, "components/app/chat/QuoteAnalysisCard.tsx"), "utf8");
    expect(quote).toContain('<div className="bg-gradient-to-r from-[var(--hb-primary)] to-[var(--hb-primary-hover)] px-6 py-5">');
    expect(quote).not.toContain("from-[#C4967E]");
    expect(quote).toContain('<p className="text-sm text-white font-medium">견적 항목 체크</p>');
  });

  it("다가오는 일정의 '지남' 은 '임박' 과 구분되고 더 강하다", () => {
    const panel = readFileSync(join(srcRoot, "components/app/chat/panel/UpcomingTab.tsx"), "utf8");
    const badge = (key: string) => new RegExp(`${key}: \\{ badge: "([^"]+)"`).exec(panel)?.[1];
    expect(badge("overdue")).toBe("bg-danger-700 text-white");
    expect(badge("urgent")).toBe("bg-[var(--hb-primary)] text-white");
    expect(contrast("#FFFFFF", colors.dangerDeep)).toBeGreaterThan(contrast("#FFFFFF", colors.rose[600]));
    expect(panel).toContain('overdue: { badge: "bg-danger-700 text-white", text: "text-danger-700" }');
  });

  it("커뮤니티 글 출처 배지는 자기 배지 바탕 위에서 읽힌다", () => {
    const source = readFileSync(join(srcRoot, "lib/community/contentOrigin.ts"), "utf8");
    const backgrounds: Record<string, string> = { "bg-[var(--hb-surface-hover)]": colors.paper.tint };
    const texts: Record<string, string> = {
      "text-rose-700": colors.rose[700],
      "text-[var(--hb-text-strong)]": colors.paper.ink,
      "text-[var(--hb-text-body)]": colors.paper.inkSoft,
    };
    const badges = [...source.matchAll(/className: "([^"]+)"/g)].map((match) => match[1]);
    expect(badges.length).toBeGreaterThanOrEqual(3);
    for (const badge of badges) {
      const bg = /(?:^|\s)(bg-\S+)/.exec(badge)?.[1] ?? "";
      const text = /(?:^|\s)(text-\S+)/.exec(badge)?.[1] ?? "";
      const bgHex = /^bg-\[(#[0-9a-fA-F]{6})\]$/.exec(bg)?.[1] ?? backgrounds[bg];
      const textHex = /^text-\[(#[0-9a-fA-F]{6})\]$/.exec(text)?.[1] ?? texts[text];
      expect(bgHex, `${badge} 의 바탕을 모른다`).toBeTruthy();
      expect(textHex, `${badge} 의 글자색을 모른다`).toBeTruthy();
      expect(contrast(textHex!, bgHex!), badge).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("커뮤니티 첫 화면의 짙은 초록 가격 영역에서 대행사 수는 쉬는·호버 상태 모두 읽힌다", () => {
    const hero = "#12302B";
    const card = over("#FFFFFF", 0.05, hero);
    for (const rowAlpha of [0.06, 0.11]) {
      const row = over("#FFFFFF", rowAlpha, card);
      expect(contrast(over("#FFFFFF", 0.45, row), row)).toBeLessThan(4.5);
      expect(contrast(over("#FFFFFF", 0.75, row), row)).toBeGreaterThanOrEqual(4.5);
    }
    const landing = readFileSync(join(srcRoot, "components/community/CommunityLandingClient.tsx"), "utf8");
    expect(landing).toContain("bg-[#12302b] px-5 py-6");
    expect(landing).toContain('<span className="shrink-0 text-white/75">대행사 {row.agencyCount}곳</span>');
  });
});

/** 선 하나로만 "누를 수 있는 것" 이 되는 컨트롤이 모여 있던 파일. */
const OUTLINE_CONTROL_FILES = [
  "components/community/StartHereClient.tsx",
  "components/community/CommunityLandingClient.tsx",
  "components/price/PriceExplorer.tsx",
  "components/price/ComboBar.tsx",
  "components/price/PriceVendorCard.tsx",
  "components/price/RegionFirstPicker.tsx",
  "components/price/BudgetFinderModal.tsx",
  "components/price/PriceEmptyState.tsx",
  "components/vendor-price/VendorDetailActions.tsx",
  "app/not-found.tsx",
  "app/error.tsx",
  "app/price/page.tsx",
  "app/start-here/page.tsx",
  "app/price/vendor/[slug]/page.tsx",
  "app/(community)/community/post/[id]/page.tsx",
  "app/(community)/community/vendor/[name]/page.tsx",
];

const CONTROL_TAGS = new Set(["button", "a", "Link", "select", "summary"]);

/** 컨트롤 요소의 className 에 들어 있는 문자열 조각 전부(조건 분기 양쪽 포함). */
function controlClassNames(path: string) {
  const text = readFileSync(join(srcRoot, path), "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Array<{ tag: string; line: number; value: string }> = [];
  const collect = (node: ts.Node, tag: string, line: number) => {
    if (ts.isStringLiteralLike(node)) found.push({ tag, line, value: node.text });
    else if (ts.isTemplateExpression(node)) {
      found.push({ tag, line, value: node.head.text });
      for (const span of node.templateSpans) found.push({ tag, line, value: span.literal.text });
    }
    ts.forEachChild(node, (child) => collect(child, tag, line));
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (CONTROL_TAGS.has(tag)) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || attribute.name.getText(file) !== "className" || !attribute.initializer) continue;
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
          collect(attribute.initializer, tag, line);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("선 하나로 구분되는 컨트롤의 경계", () => {
  it("반투명 모브 선은 3:1 에 못 미치고, paper.outline 은 세 지면 모두에서 넘는다", () => {
    for (const alpha of [0.12, 0.15, 0.2, 0.25, 0.35]) {
      expect(contrast(over(colors.rose[600], alpha, colors.paper.card), colors.paper.card)).toBeLessThan(3);
    }
    for (const bg of [colors.paper.sheet, colors.paper.card, colors.paper.tint]) {
      expect(contrast(colors.paper.outline, bg)).toBeGreaterThanOrEqual(3);
    }
    // 모브 띠 위의 선 버튼은 불투명 흰 선이다(white/30 은 1.77:1).
    expect(contrast(over("#FFFFFF", 0.3, colors.rose[600]), colors.rose[600])).toBeLessThan(3);
    expect(contrast("#FFFFFF", colors.rose[600])).toBeGreaterThanOrEqual(3);
  });

  it.each(OUTLINE_CONTROL_FILES)("%s 의 컨트롤은 반투명 모브·흰 선을 경계로 쓰지 않는다", (path) => {
    const classNames = controlClassNames(path);
    expect(classNames.length, `${path} 에서 컨트롤을 못 찾았다`).toBeGreaterThan(0);
    // 호버·포커스 선은 쉬는 상태의 경계가 아니다 — 접두어 없는 선만 본다.
    // 네 변을 두른 `border` 만 경계다. `border-t` 같은 한 변 구분선은 컨트롤의 윤곽이 아니다.
    const translucent = /(?<![\w:[-])border-(?:\[var\(--hb-primary\)\]|\[#8F6662\])\/\d+/;
    const box = /(?:^|\s)border(?:\s|$)/;
    // 윤곽(`border`)은 템플릿 머리에, 색은 조건 분기 문자열에 따로 있을 수 있다 — 요소 단위로 본다.
    const elements = new Map<string, string[]>();
    for (const { tag, line, value } of classNames) {
      const key = `${tag}:${line}`;
      elements.set(key, [...(elements.get(key) ?? []), value]);
    }
    const hits: string[] = [];
    for (const [key, fragments] of elements) {
      if (!fragments.some((value) => box.test(value))) continue;
      for (const value of fragments.filter((fragment) => translucent.test(fragment))) hits.push(`${key} ${value.trim()}`);
    }
    expect(hits).toEqual([]);
  });

  it("시작 안내의 선 버튼·칩은 paper.outline 을 쓴다", () => {
    const start = readFileSync(join(srcRoot, "components/community/StartHereClient.tsx"), "utf8");
    expect(start.match(/border-\[var\(--color-paper-outline\)\]/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(start).toContain("border border-[var(--hb-on-primary)] px-5 text-[14px] font-semibold text-white");
  });
});
