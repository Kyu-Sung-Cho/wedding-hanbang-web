// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  contentBlock,
  everyLandingComponent,
  landingComponentFiles,
  rendered,
  renderedSections,
  source,
  stripComments,
} from "./landingSource";

/**
 * 랜딩 디자인 시스템 계약.
 *
 * 2026-08-05 실측에서 나온 드리프트를 고정한다. 이 파일이 막는 것:
 *  - 토큰에도 DESIGN.md에도 없는 색을 새로 만드는 것
 *  - 같은 기본 행동을 서로 다른 실루엣으로 그리는 것
 *  - 일회성 box-shadow로 elevation을 매번 다시 정하는 것
 *  - 섹션마다 다른 세로 리듬을 쓰는 것
 *  - DESIGN.md 라운드 스케일 밖 값을 쓰는 것
 *
 * ## 2026-08-27 재조준 — 공유 레시피의 자리가 옮겨졌다
 *
 * 랜딩이 "결혼 준비 노트"로 다시 지어지면서 계약이 사는 곳이 바뀌었다.
 *
 *   옛 구조  `landingType.ts` 의 문자열 상수(primaryAction*·sectionEyebrow·
 *            sectionLede·sectionRhythm·secondaryLink·eyebrowGlyph)를 각 섹션이
 *            템플릿에 끼워 넣었다.
 *   새 구조  `notebook.tsx` 의 컴포넌트·상수(`Section`·`NoteCard`·`band`·`shell`·
 *            `bodyText`·`noteText`·`ruled`)와 `globals.css` 의 랜딩 블록
 *            (`.landing-tape`·`.landing-note`·`.landing-hand`)이 같은 일을 한다.
 *
 * `landingType.ts` 는 파일로 남아 있지만 랜딩 컴포넌트의 참조가 0건이다. 그래서
 * 아래 단언들은 더 이상 그 파일을 보지 않고 **실제로 화면을 그리는 쪽**을 본다.
 * 막으려는 것은 하나도 바뀌지 않았다. 지키는 자리만 옮겼다.
 *
 * ## 2026-08-28 구멍 메우기 — 적대적 변형이 그냥 통과했다
 *
 * 이 파일이 놓쳤던 것들(전부 실제로 심어 보고 확인했다):
 *
 *  - **주석이 코드 대신 대답했다.** 원문을 그대로 읽어서 `py-24(96px)였다` 같은
 *    주석 속 문자열이 코드처럼 세어졌다. 이제 `landingSource.ts` 의 주석 벗긴
 *    소스만 본다. 반대 방향도 같다 — 주석에 `font-bold` 를 적어 웨이트 채널이
 *    살아 있는 척할 수 없다.
 *  - **컴포넌트 폴더만 봤다.** `app/landing/page.tsx` 본체·`opengraph-image.tsx`
 *    가 자기 hex 를 적어도 아무도 안 봤다. 이제 세 지면을 같이 본다.
 *  - **표기 하나만 막았다.** 6자리 hex 만 봐서 `#f0a`·`rgba()`·
 *    `var(--없는변수, red)` 폴백이 다 빠져나갔다. `py-` 만 봐서 `pt-24 pb-24` 와
 *    `py-[6rem]` 이 빠져나갔다. `text-[19px]` 만 봐서 `text-[1.19rem]` 이 빠져나갔다.
 *  - **손으로 적은 목록이 새 파일을 놓쳤다.** 본문 섹션 일곱 개를 배열로 적어
 *    두어, 페이지에 새 섹션을 끼워 넣으면 리듬 검사를 받지 않았다. 이제
 *    `renderedSections()` 로 페이지가 실제로 그리는 것에서 뽑는다.
 *  - **`className="…"` 만 봤다.** 템플릿 리터럴 className 과 상수로 뺀 클래스
 *    문자열이 전부 사각지대였다. 이제 파일 안의 모든 문자열 리터럴을 본다.
 *  - **죽은 가드.** `slice(indexOf(a), indexOf(b))` 뒤 `length > 0` 은 경계가
 *    사라져도 영원히 참이다(`slice(-1)` 이 마지막 한 글자를 준다). 못 찾으면
 *    던지는 `contentBlock()` 으로 갈아탔다.
 */

/** 화면을 그리는 랜딩 컴포넌트 — 폴더에서 읽고, 주석은 벗긴 뒤. */
const components = everyLandingComponent();

/**
 * 색·타입·모서리는 컴포넌트 폴더 밖에서도 정해진다.
 *
 * 2026-08-28: `page.tsx` 본체에 정체불명 hex 를 심었더니 아무 단언도 울지 않았다.
 * 랜딩이 사용자에게 나가는 지면은 셋이다 — 컴포넌트 · 페이지 본체 · OG 카드.
 */
const LANDING_PAGE = "src/app/landing/page.tsx";
const LANDING_OG = "src/app/landing/opengraph-image.tsx";
const surfaces: Array<[string, string]> = [
  ...components,
  ["app/landing/page.tsx", rendered(LANDING_PAGE)],
  ["app/landing/opengraph-image.tsx", rendered(LANDING_OG)],
];

const globalsRaw = source("src/app/globals.css");
/** globals.css 도 주석을 벗겨 본다 — 주석에 적은 선언이 계약을 만족시키면 안 된다. */
const globals = stripComments(globalsRaw);
/** DESIGN.md 는 산문이라 벗기지 않는다. 여기서는 값이 적혀 있는지만 본다. */
const designMd = source("../../DESIGN.md");

const sourceOf = (file: string) => components.find(([name]) => name === file)?.[1] ?? "";
const notebook = sourceOf("notebook.tsx");

/**
 * globals.css 의 랜딩 블록(파일 맨 끝).
 *
 * 주석 머리말(`랜딩 — 결혼 준비 노트`)로 자르면 주석을 벗긴 뒤엔 그 표시가 없다.
 * 그래서 코드로 남는 첫 선택자를 경계로 쓰고, **못 찾으면 던진다** — 경계가
 * 사라졌는데 조용히 빈 문자열을 검사하는 것이 이 파일의 옛 실패 방식이었다.
 */
const landingCss = (() => {
  const start = globals.indexOf(".landing-hand {");
  if (start < 0) {
    throw new Error(
      "globals.css 에서 랜딩 블록(.landing-hand)을 찾지 못했습니다. "
        + "블록이 옮겨졌다면 이 검사도 같이 옮겨야 합니다.",
    );
  }
  return globals.slice(start);
})();

/**
 * 본문 섹션 — **페이지가 실제로 그리는 것**에서 뽑는다.
 *
 * 옛 판은 일곱 개를 손으로 적어 뒀다. 그래서 page.tsx 에 새 섹션을 끼워 넣으면
 * 리듬·eyebrow·본문 문체 검사를 하나도 받지 않았다(2026-08-28 변형으로 확인).
 * 첫째(히어로)와 마지막(마무리)은 자기 리듬을 갖는 두 예외라 따로 뺀다.
 */
const HERO = "TransformationHero";
const CLOSING = "ClosingAction";
const bodySections = renderedSections()
  .filter((name) => name !== HERO && name !== CLOSING)
  .map((name) => `${name}.tsx`);

/** 파일 안의 모든 문자열·템플릿 리터럴. className 이 어디에 적혔든 한 곳으로 모은다. */
const styleLiterals = (src: string) =>
  [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/gu)].map((m) => m[1] ?? m[2] ?? "");

/** 유틸리티 하나를 낱말 단위로 찾는다. `underline` 이 `underline-offset-4` 에 걸리지 않게. */
const hasUtility = (text: string, utility: string) =>
  new RegExp(
    String.raw`(?<![\w-])(?:[a-z0-9[\]().,%_-]+:)*` + utility + String.raw`(?![\w-])`,
    "u",
  ).test(text);

/** globals.css @theme 에 적힌 토큰 값. */
const hexOf = (token: string) =>
  new RegExp(token + String.raw`:\s*(#[0-9A-Fa-f]{6})`, "u").exec(globals)?.[1] ?? "";

/** WCAG 2.x 상대 휘도 대비. */
const luminance = (hex: string) => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(parseInt(hex.slice(1, 3), 16))
    + 0.7152 * channel(parseInt(hex.slice(3, 5), 16))
    + 0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  );
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Tailwind 스텝(`24`)·arbitrary 값(`[76px]`·`[6rem]`)을 px 로 환산한다.
 * 잴 수 없는 것(`calc()`·`clamp()`)은 null 을 돌려준다.
 */
const toPx = (raw: string): number | null => {
  if (/^\d+(?:\.\d+)?$/u.test(raw)) return Number(raw) * 4;
  const unit = /^(\d+(?:\.\d+)?)(px|rem)$/u.exec(raw);
  if (!unit) return null;
  return unit[2] === "px" ? Number(unit[1]) : Number(unit[1]) * 16;
};

describe("landing design system", () => {
  it("keeps looking at the sections the page really renders", () => {
    // 아래 단언들이 도는 대상 자체가 비어 버리면 전부 빈 통과가 된다.
    // 렌더 순서에서 뽑은 목록이 실제 파일과 이어지는지 먼저 못 박는다.
    expect(bodySections.length, "본문 섹션을 못 찾았다 — page.tsx 구조가 바뀌었다")
      .toBeGreaterThanOrEqual(7);
    const files = new Set(landingComponentFiles());
    for (const file of bodySections) {
      expect(files.has(file), `${file}: page.tsx 가 그리는데 컴포넌트 파일이 없다`).toBe(true);
    }
    expect(renderedSections(), "히어로와 마무리는 페이지의 처음과 끝이다")
      .toEqual([HERO, ...bodySections.map((f) => f.replace(/\.tsx$/u, "")), CLOSING]);
  });

  it("uses no colour that is absent from both the tokens and DESIGN.md", () => {
    const known = (globals + designMd).toUpperCase();
    const strays = new Map<string, string[]>();

    // 3·4·6·8자리를 전부 본다. 옛 판은 6자리만 봐서 `text-[#f0a]` 가 통과했다.
    for (const [file, src] of surfaces) {
      for (const match of src.matchAll(/#([0-9A-Fa-f]{3,8})(?![0-9A-Fa-f])/gu)) {
        const digits = match[1];
        if (![3, 4, 6, 8].includes(digits.length)) continue;
        // 짧은 표기를 6자리로 펴서 비교한다(#f0a === #FF00AA), 알파는 뗀다.
        const six =
          digits.length <= 4
            ? digits.slice(0, 3).split("").map((d) => d + d).join("")
            : digits.slice(0, 6);
        const hex = `#${six}`.toUpperCase();
        if (known.includes(hex)) continue;
        strays.set(match[0], [...(strays.get(match[0]) ?? []), file]);
      }
    }

    expect(
      [...strays.entries()].map(([hex, files]) => `${hex} (${[...new Set(files)].join(", ")})`),
      "새 색을 만들지 말고 globals.css @theme와 DESIGN.md에 먼저 토큰으로 올린다",
    ).toEqual([]);

    // hex 가 아닌 색 함수 리터럴도 같은 사고다 — 토큰을 지나지 않는 새 색이다.
    // `rgba(184,69,47,.2)` 는 어느 출처에도 없지만 hex 검사에는 걸리지 않았다.
    const literals = new Map<string, string[]>();
    for (const [file, src] of surfaces) {
      for (const m of src.matchAll(/(?<![\w-])(?:rgba?|hsla?|oklch|lab|color-mix)\(/gu)) {
        literals.set(m[0], [...(literals.get(m[0]) ?? []), file]);
      }
    }
    expect(
      [...literals.entries()].map(([fn, f]) => `${fn} (${[...new Set(f)].join(", ")})`),
      "색 함수 리터럴을 컴포넌트에 적지 말고 globals.css 토큰으로 올린다",
    ).toEqual([]);

    // 2026-08-27: 새 랜딩은 색을 hex로 적지 않고 `var(--color-paper-*)`로 부른다.
    // 그래서 hex 검사만으로는 "없는 색을 만드는 것"을 더 이상 못 잡는다 — 정의되지
    // 않은 변수를 부르면 실패가 아니라 **아무 색도 안 입은 채** 조용히 넘어간다.
    // 같은 사고를 새 표기에서 막는다.
    //
    // 2026-08-28: 옛 정규식은 `var\((--color-[a-z0-9-]+)\)` 라 닫는 괄호가 바로
    // 오는 형태만 봤다. `var(--color-없는것, red)` 처럼 **폴백을 달면** 검사 대상이
    // 아니게 되고, 폴백 값이 그대로 화면에 칠해졌다. 폴백 자체를 금지한다 —
    // 폴백이 필요하다는 것은 토큰이 없다는 뜻이고, 그러면 토큰을 먼저 올려야 한다.
    let varRefs = 0;
    const undefinedVars = new Map<string, string[]>();
    const fallbacks = new Map<string, string[]>();
    for (const [file, src] of surfaces) {
      for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,[^)]*)?\)/gu)) {
        varRefs += 1;
        if (m[2]) fallbacks.set(m[0], [...(fallbacks.get(m[0]) ?? []), file]);
        if (globals.includes(`${m[1]}:`)) continue;
        undefinedVars.set(m[1], [...(undefinedVars.get(m[1]) ?? []), file]);
      }
    }
    // 정규식이 낡으면 0건을 세고도 통과한다(2026-08-28 실측 115건).
    expect(varRefs, "var() 참조를 하나도 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(60);
    expect(
      [...undefinedVars.entries()].map(([v, f]) => `${v} (${[...new Set(f)].join(", ")})`),
      "globals.css에 없는 색 변수를 부르면 그 자리는 색이 없는 채로 렌더된다",
    ).toEqual([]);
    expect(
      [...fallbacks.entries()].map(([v, f]) => `${v} (${[...new Set(f)].join(", ")})`),
      "var() 폴백은 토큰을 지나지 않는 색이다 — 토큰을 먼저 올린다",
    ).toEqual([]);
  });

  it("promotes every colour the landing invented into real tokens", () => {
    // 2026-08-05: 이 둘은 랜딩이 각각 9곳·7곳에서 쓰고 있었는데 어느 출처에도 없었다.
    // 2026-08-27 개편으로 랜딩은 더 이상 이 둘을 쓰지 않지만, 승격 결정은 DESIGN.md
    // 결정 로그에 남아 있고 제품 화면이 이어받았다. 지우지 않고 그대로 고정한다.
    for (const [token, hex] of [
      ["--color-rose-700", "#7D5753"],
      ["--color-ivory-blush", "#F3E9DD"],
    ]) {
      expect(globals, `${token}이 @theme에 없다`).toContain(`${token}: ${hex}`);
      expect(designMd, `${hex}가 DESIGN.md 팔레트에 기록되지 않았다`).toContain(hex);
    }

    // 이번 판이 발명한 것은 종이와 필기구다(`--color-paper-*`). 같은 실수 —
    // 화면에는 쓰는데 어느 출처에도 없는 색 — 를 반복하지 않았는지 본다.
    // 세 지면이 실제로 부르는 토큰만 센다(폴백 형태도 같이 잡는다).
    const paperTokens = [
      ...new Set(
        surfaces.flatMap(([, s]) =>
          [...s.matchAll(/var\(\s*(--color-paper-[a-z-]+)\s*(?:,[^)]*)?\)/gu)].map((m) => m[1]),
        ),
      ),
    ].sort();
    // 정규식이 낡으면 0개를 세고도 통과한다. 하한을 둔다(2026-08-27 실측 12종).
    expect(paperTokens.length, "paper 토큰을 하나도 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(10);

    const missing: string[] = [];
    for (const token of paperTokens) {
      const hex = hexOf(token);
      expect(hex, `${token}이 globals.css @theme에 없다`).not.toBe("");
      if (!designMd.toUpperCase().includes(hex.toUpperCase())) missing.push(`${token} ${hex}`);
    }
    expect(missing, "DESIGN.md Color 절 'Paper — landing only'에 값을 먼저 올린다").toEqual([]);
  });

  it("draws every primary action from one silhouette", () => {
    // 옛 구조는 `landingType.ts`의 primaryActionSm/Md/Lg를 세 배치가 나눠 썼다.
    // 2026-08-27 개편에서 그 상수를 부르는 곳이 0건이 됐고, 버튼은 각 컴포넌트가
    // 클래스 문자열을 직접 적는다. 공유 심볼이 없으니 "레시피를 쓰는가"는 물을
    // 대상이 사라졌다 — 대신 이 단언이 원래 지키려던 것을 직접 잰다.
    //
    //   하나의 행동은 하나의 물체로 읽혀야 한다.
    //
    // 크기(px-·min-h-·text-)만 자리에 따라 다르고, 실루엣(모서리·웨이트·글자색)은
    // 하나여야 한다. 공유 레시피가 없다는 사실 자체는 제품 문제로 따로 보고한다 —
    // 여기서 심볼 이름을 발명하면 제품이 합의한 적 없는 계약이 된다.
    const inkButtons: Array<[string, string]> = [];
    const outlineButtons: Array<[string, string]> = [];
    for (const [file, src] of surfaces) {
      for (const c of styleLiterals(src)) {
        if (!c.includes("inline-flex")) continue;
        if (c.includes("bg-[var(--color-paper-ink)]")) inkButtons.push([file, c]);
        else if (c.includes("border-[var(--color-paper-outline)]")) outlineButtons.push([file, c]);
      }
    }
    // 실측(2026-08-27): 잉크 버튼 5개(헤더·히어로·장면·마무리·확인 섹션의 그림 버튼),
    // 테두리 버튼 3개. 정규식이 낡아 0개를 세고 통과하는 것을 막는다.
    expect(inkButtons.length, "기본 행동 버튼을 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(4);
    expect(outlineButtons.length, "보조 버튼을 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(2);

    const silhouette = (c: string) =>
      [
        /rounded-\[[^\]]+\]|rounded-(?:none|sm|md|lg|xl|2xl|3xl|full)/u.exec(c)?.[0] ?? "(모서리 없음)",
        /font-(?:normal|medium|semibold|bold)/u.exec(c)?.[0] ?? "(웨이트 없음)",
        /text-\[var\(--color-paper-[a-z-]+\)\]/u.exec(c)?.[0] ?? "(글자색 없음)",
      ].join(" ");

    for (const [label, buttons] of [
      ["기본 행동", inkButtons],
      ["보조 행동", outlineButtons],
    ] as const) {
      const shapes = new Map<string, string[]>();
      for (const [file, c] of buttons) {
        const key = silhouette(c);
        shapes.set(key, [...(shapes.get(key) ?? []), file]);
      }
      expect(
        [...shapes.entries()].map(([s, f]) => `${s} ← ${[...new Set(f)].join(", ")}`),
        `${label} 버튼이 두 가지 이상의 실루엣으로 그려졌다`,
      ).toHaveLength(1);
    }
  });

  it("uses only the two elevation tokens, never a one-off shadow", () => {
    expect(globals).toContain("--shadow-raised");
    expect(globals).toContain("--shadow-overlay");
    for (const [file, src] of surfaces) {
      const oneOff = [...src.matchAll(/(?:drop-)?shadow-\[[^\]]*\]/gu)].map((m) => m[0]);
      expect(oneOff, `${file}에 일회성 그림자가 있다`).toEqual([]);
    }

    // 알아 두고 통과시키는 것: 노트 카드의 들림은 globals.css `.landing-note`의
    // `box-shadow: 0 10px 24px rgba(38,37,31,.07)`이다. 두 토큰 어느 쪽도 아니지만
    // 이 규칙이 막는 것은 "컴포넌트마다 다시 정하는 것"이고, 저건 공유 프리미티브
    // 한 곳에 한 번 적힌 값이라 여기서 잡지 않는다. 두 번째가 생기면 그때가 드리프트다.
    //
    // 2026-08-28: **"두 번째가 생기면"을 아무도 안 보고 있었다.** globals.css 랜딩
    // 블록에 일회성 box-shadow 를 하나 더 넣어도 컴포넌트만 읽는 위 검사는 조용했다.
    // 랜딩 블록의 box-shadow 를 통째로 세어 하나로 못 박는다.
    const shadows = [...landingCss.matchAll(/box-shadow:\s*([^;]+);/gu)].map((m) =>
      m[1].replace(/\s+/gu, " ").trim(),
    );
    expect(shadows, "랜딩 CSS 블록의 elevation 은 노트 카드 한 줄뿐이다").toEqual([
      "0 10px 24px rgba(38, 37, 31, 0.07)",
    ]);
  });

  it("drives section vertical rhythm from one shared step", () => {
    // 옛 구조는 두 단계였다(sectionRhythm·sectionRhythmCompact). 낮은 단계를 쓰던
    // 커뮤니티 안내 띠 섹션이 2026-08-27 개편에서 삭제돼 그 단계는 지킬 대상이
    // 없어졌고, 본문 섹션은 전부 <Section>을 지나므로 리듬이 `band` 하나로 줄었다.
    expect(notebook, "공유 리듬 상수가 없다").toContain('export const band = "py-14 sm:py-[76px]"');

    for (const file of bodySections) {
      const src = sourceOf(file);
      expect(src, `${file}이 <Section>을 지나지 않아 band를 못 받는다`).toMatch(/<Section[\s>]/u);
    }

    // 세로 리듬 인구조사.
    //
    // 옛 판은 (1) 본문 섹션 일곱 개만, (2) `py-` 만, (3) `sm:|lg:|xl:` 접두사만,
    // (4) 정수 스텝과 `[Npx]` 만 봤다. 그래서 다음이 전부 빠져나갔다 —
    // `pt-24 pb-24`(비대칭 표기) · `py-[6rem]`(rem) · `max-sm:py-24`(다른 변형) ·
    // 그리고 본문 섹션이 **아닌** 새 파일이 자기 리듬을 정하는 것.
    //
    // 이제 랜딩 지면 전부에서 48px(py-12) 이상 세로 패딩을 모아 아래 인구조사와
    // 정확히 맞는지 본다. 새 단계가 필요하면 여기에 적어야 하고, 그 순간 리뷰어가
    // "리듬이 몇 단계인가"를 한눈에 본다. 목록을 늘려 통과시키는 것이 곧 결정이다.
    const rhythm = new Map<string, string[]>();
    for (const [file, src] of surfaces) {
      for (const m of src.matchAll(
        /(?<![\w-])(?:[a-z0-9[\]().,%_-]+:)*p[tby]?-(?:(\d+(?:\.\d+)?)|\[([^\]]+)\])(?![\w-])/gu,
      )) {
        const px = toPx(m[1] ?? m[2] ?? "");
        if (px === null || px < 48) continue;
        rhythm.set(file, [...(rhythm.get(file) ?? []), m[0]]);
      }
    }
    expect(
      Object.fromEntries([...rhythm.entries()].map(([f, v]) => [f, [...v].sort()])),
      "섹션 세로 리듬이 늘었다 — 새 단계를 만들기 전에 band 를 쓸 수 없는 이유를 적어라",
    ).toEqual({
      // 공유 한 단계. 본문 섹션 일곱 개가 전부 이걸 지난다.
      "notebook.tsx": ["py-14", "sm:py-[76px]"],
      // 마무리는 본문보다 깊은 두 번째 단계다(76 → 112px).
      "ClosingAction.tsx": ["py-20", "sm:py-28"],
      // 히어로는 부케 자리 때문에 위아래가 비대칭이다. 값은 고정하되 대칭은 요구하지 않는다.
      "TransformationHero.tsx": ["lg:pb-20", "pb-60", "pt-12", "sm:pt-16"],
      // 푸터는 섹션이 아니라 페이지를 닫는 띠다.
      "LandingFooter.tsx": ["py-14"],
    });

    // `<section>`을 직접 여는 파일이 늘면 리듬이 다시 흩어진다 — 390px에서 5종,
    // 1280px에서 6종까지 갔던 적이 있다. 지금 허용되는 것은 Section 본체와
    // 페이지를 여닫는 두 곳뿐이다.
    const rawSections = components
      .filter(([, s]) => /<section[\s>]/u.test(s))
      .map(([name]) => name)
      .sort();
    expect(rawSections, "새 섹션이 <Section>을 지나지 않고 자기 <section>을 열었다").toEqual([
      "ClosingAction.tsx",
      "TransformationHero.tsx",
      "notebook.tsx",
    ]);
  });

  it("keeps every fixed type size on the DESIGN.md scale", () => {
    // 스케일: xs12 sm14 base16 lg18 xl20 2xl24 3xl30 4xl36 5xl48.
    // clamp()로 흐르는 디스플레이 타입은 여기서 제외한다 — 그건 notebook.tsx의
    // `sectionTitle`·`bodyText`가 따로 고정한다(옛 구조에서는 landingType.ts의
    // 3단계였다). 여기서 보는 것은 고정 값이다.
    //
    // 도입 시점 실측: 스케일 밖 고정값이 49곳 있었고 13px 20곳·15px 11곳이 최다였다.
    // 2026-08-27 노트 개편 직후 실측: 20곳(15px 10곳 · 13px 6곳 · 17·19·21·22px 각 1곳).
    // **2026-08-28 재실측: 0곳** — 값이 전부 스케일로 정렬됐다. 그러니 이 단언은
    // 지금 빚을 세는 게 아니라 되돌아오는 것을 막는다. 다시 빨개지면 고칠 곳은 둘뿐이고
    // 둘 다 테스트 밖에 있다 — 값을 스케일로 되돌리거나, DESIGN.md에 랜딩 타입 스케일
    // 예외를 적는 것. 허용 집합을 늘려서 통과시키지 않는다.
    //
    // 2026-08-28: px 만 봐서 `text-[1.19rem]`(=19px)이 빠져나갔다. rem 도 같이 잰다.
    // `em`·`%`·`ch` 는 부모 크기에 딸린 상대값이라 스케일로 잴 수 없다 —
    // 지금 랜딩에 하나 있고(`Circled` 의 `text-[1.05em]`) 그건 장식의 광학 보정이다.
    const allowed = new Set([12, 14, 16, 18, 20, 24, 30, 36, 48]);
    const off = new Map<string, string[]>();
    for (const [file, src] of surfaces) {
      for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/gu)) {
        const px = m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
        if (allowed.has(px)) continue;
        const key = `${px}px (${m[0]})`;
        off.set(key, [...(off.get(key) ?? []), file]);
      }
    }
    expect(
      [...off.entries()].map(([px, files]) => `${px} ${[...new Set(files)].join(", ")}`),
      "크기로 위계를 만들지 말고 웨이트를 쓴다",
    ).toEqual([]);
  });

  it("actually uses the weight axis instead of leaning on size alone", () => {
    // DESIGN.md Typography: "weight, size, color, spacing으로 위계를 만든다".
    // 도입 전 실측은 semibold 72 + medium 8, bold·light 0이었다. 웨이트가 사실상
    // 하나뿐이면 크기가 유일한 채널이 되고, 그래서 off-scale px가 늘어난다.
    //
    // 2026-08-27 재조준: 새 랜딩에서 "작아도 먼저 읽혀야 하는 것"의 자리는
    // `font-bold`가 아니라 손글씨 `.landing-hand`가 맡는다. 그 클래스는 유틸리티가
    // 아니라 globals.css가 `font-weight: 700`으로 고정한 것이므로 웨이트 채널이
    // 맞다. 가정하지 않고 먼저 확인한다 — 700이 아니면 이 대체는 성립하지 않는다.
    expect(globals, ".landing-hand가 700을 고정하지 않는다").toMatch(
      /\.landing-hand\s*\{[^}]*font-weight:\s*700/u,
    );

    // 2026-08-28: 옛 판은 `font-bold + landing-hand` 를 **더해서** 하한을 봤다.
    // 손글씨가 13곳이라 합이 늘 크고, 그래서 저장소에 하나뿐인 `font-bold`(푸터의
    // 12px 그룹 라벨 — 작지만 먼저 읽혀야 하는 자리)를 지워도 초록이었다.
    // 채널마다 따로 센다. 채널 하나가 사라지는 것이 곧 위계가 무너지는 것이다.
    const all = surfaces.map(([, s]) => s).join("\n");
    // 낱말 단위로 센다. `font-bold` 를 부분 문자열로 세면 `font-boldish` 도 세어진다.
    const count = (utility: string) =>
      (all.match(
        new RegExp(String.raw`(?<![\w-])` + utility + String.raw`(?![\w-])`, "gu"),
      ) ?? []).length;
    expect(
      count("font-bold"),
      "12px 그룹 라벨은 크기가 아니라 굵기로 먼저 읽힌다 — 이 채널을 지우지 마라",
    ).toBeGreaterThanOrEqual(1);
    expect(
      count("landing-hand"),
      "손글씨(700)가 사라지면 굵은 채널이 푸터 라벨 하나로 줄어든다",
    ).toBeGreaterThanOrEqual(8);
    expect(count("font-medium")).toBeGreaterThanOrEqual(3);
    expect(count("font-semibold")).toBeGreaterThanOrEqual(3);
  });

  it("draws every section eyebrow and lede from one shared recipe", () => {
    // 옛 구조: landingType.ts의 sectionEyebrow/sectionLede 문자열을 섹션이 각자 붙였다.
    // 새 구조: eyebrow는 <Section>이 테이프 이름표로 한 번만 그리고, 본문 문체는
    // notebook.tsx의 bodyText/noteText/ruled가 맡는다. 지키는 것은 같다 —
    // 같은 층위의 라벨과 본문이 섹션마다 다른 격식으로 읽히지 않게 하는 것.
    for (const sym of ["export const bodyText", "export const noteText", "export const ruled"]) {
      expect(notebook, `${sym}이 없다`).toContain(sym);
    }

    // 테이프 이름표는 <Section> 안에서만 그린다. 섹션이 자기 eyebrow를 따로 그리면
    // 크기·기울기·색이 다시 갈린다(옛 랜딩에서 eyebrow 여덟 개가 그렇게 갈렸다).
    const tapeOwners = surfaces.filter(([, s]) => s.includes("landing-tape")).map(([n]) => n);
    expect(tapeOwners, "eyebrow를 <Section> 밖에서 다시 그렸다").toEqual(["notebook.tsx"]);

    // 2026-08-28: 옛 판은 `source.includes("bodyText")` 였다. 그래서 **import 만
    // 지우고 사용을 남겨도** 통과했고(컴파일은 깨지는데 테스트는 초록),
    // 반대로 **import 만 남기고 사용을 지워도** 통과했다. 둘을 나눠 본다.
    const importedSymbols = (src: string) =>
      new Set(
        (/import\s*\{([^}]*)\}\s*from\s*"\.\/notebook"/u.exec(src)?.[1] ?? "")
          .split(",")
          .map((s) => s.trim().replace(/^type\s+/u, ""))
          .filter(Boolean),
      );
    /** import 구문을 걷어 낸 나머지 — 여기에 남아야 "실제로 쓴다". */
    const bodyOf = (src: string) => src.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]*";/gu, "");

    for (const file of bodySections) {
      const src = sourceOf(file);
      const imported = importedSymbols(src);
      const body = bodyOf(src);

      expect(src.includes("eyebrow="), `${file}이 공유 eyebrow를 쓰지 않는다`).toBe(true);
      for (const sym of ["bodyText", "noteText"]) {
        expect(imported.has(sym), `${file}이 notebook에서 ${sym}을 받아오지 않는다`).toBe(true);
        expect(body.includes(sym), `${file}이 ${sym}을 import만 하고 쓰지 않는다`).toBe(true);
      }
    }

    // 흐르는 디스플레이 타입(clamp)은 공유 스케일의 몫이다. 섹션이 자기 clamp 를
    // 적기 시작하면 본문 곡선이 섹션마다 갈린다 — 손으로 적은 `text-[19px]
    // leading-[1.9]` 가 그 시작이었다(2026-08-28 변형). 소유자를 못 박는다.
    const clampOwners = surfaces
      .filter(([, s]) => s.includes("text-[clamp("))
      .map(([n]) => n)
      .sort();
    expect(clampOwners, "흐르는 타입은 notebook 의 공유 스케일과 H1 만 정한다").toEqual([
      "TransformationHero.tsx",
      "notebook.tsx",
    ]);

    // 12px 라벨은 4.5:1이 필요하다. 옛 eyebrow(rose-600 on ivory-blush)가 4.13:1로
    // 미달해서 rose-700으로 올렸던 자리다. 지면이 테이프로 바뀌었으니 대비는 처음부터
    // 다시 계산돼야 한다 — `.landing-tape`는 16px/700이라 WCAG 큰 글자 예외
    // (18.66px 이상 굵은 글씨)를 여전히 받지 못한다.
    expect(contrast(hexOf("--color-paper-tape-ink"), hexOf("--color-paper-tape"))).toBeGreaterThanOrEqual(4.5);
  });

  it("draws every standalone secondary link from one recipe", () => {
    // 옛 구조: secondaryLink / secondaryLinkOnDark / inlineLink 세 상수.
    // 새 랜딩에는 어두운 지면이 없어졌고(전부 종이 위다) 문장 안에 흐르는 링크도
    // 없다. 그래서 on-dark와 inline 두 갈래는 지킬 대상이 사라졌다 — 문단 안 44px
    // 금지는 아래 별도 단언이 계속 지킨다.
    //
    // 남은 것은 문장 밖에 홀로 서는 링크다. 공유 심볼이 없으니 기본 행동 버튼과
    // 같은 방법으로 잰다: 같은 역할은 같은 실루엣이어야 한다.
    //
    // 2026-08-28: 옛 판은 `underline && inline-flex` 둘 다 가진 클래스만 골랐다.
    // 그래서 **`inline-flex` 없이 새로 조립한 밑줄 링크**는 다섯 토큰을 하나도 안
    // 지켜도 검사 대상이 아니었다. 이제 `underline` 을 단 것은 전부 대상이고,
    // `inline-flex` 도 지켜야 할 토큰 중 하나다.
    const links = surfaces.flatMap(([file, src]) =>
      styleLiterals(src)
        .filter((c) => hasUtility(c, "underline"))
        .map((c) => [file, c] as const),
    );
    expect(links.length, "보조 링크를 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(4);

    // 위반을 모아서 한 번에 단언한다. 링크마다 즉시 던지면 **먼저 나온 위반 하나가
    // 나머지를 가린다** — 실제로 그것 때문에 새로 심은 위반이 안 보였다(2026-08-28).
    const offenders: string[] = [];
    for (const [file, c] of links) {
      const missing = [
        "inline-flex", // 문장 밖 링크는 자기 상자를 갖는다
        "min-h-11", // 문장 밖 링크는 44px 대상이다
        "font-semibold",
        "text-[var(--color-paper-pen)]",
        "underline-offset-4",
        "hover:text-[var(--color-paper-pen-deep)]",
      ].filter((token) => !c.includes(token));
      if (missing.length > 0) offenders.push(`${file}: ${missing.join(", ")} 없음`);
    }
    expect(offenders, "홀로 서는 밑줄 링크를 레시피 없이 새로 조립했다").toEqual([]);

    // 토큰이 다 있어도 조합이 갈릴 수 있다. 실루엣이 하나인지 마지막으로 본다.
    const shapes = new Map<string, string[]>();
    for (const [file, c] of links) {
      const key = [
        /(?<![\w-])font-(?:normal|medium|semibold|bold)(?![\w-])/u.exec(c)?.[0] ?? "(웨이트 없음)",
        /(?<![\w-])min-h-\S+/u.exec(c)?.[0] ?? "(높이 없음)",
        /(?<![\w-])underline-offset-\S+/u.exec(c)?.[0] ?? "(오프셋 없음)",
      ].join(" ");
      shapes.set(key, [...(shapes.get(key) ?? []), file]);
    }
    expect(
      [...shapes.entries()].map(([s, f]) => `${s} ← ${[...new Set(f)].join(", ")}`),
      "홀로 서는 밑줄 링크가 두 가지 이상의 실루엣으로 그려졌다",
    ).toHaveLength(1);
  });

  it("never re-declares the eyebrow type size inline", () => {
    // 옛 구조는 sectionEyebrowTypography(12px·bold·자간)를 두었는데 히어로가 그 세
    // 유틸리티를 그대로 인라인 복제하고 있었다. 새 구조에서 그 자리는 globals.css의
    // `.landing-tape`다 — 크기·웨이트가 CSS 한 곳에 있다.
    //
    // 2026-08-28: 값이 12px → 16px 로 바뀌었다(globals.css 에 이유가 적혀 있다 —
    // Gaegu 는 같은 px 에서 Paperlogy 보다 작아 보인다). 이 단언이 지키는 것은
    // 특정 숫자가 아니라 **크기를 한 곳에서만 정한다**는 것이므로 값을 옮겨 적되,
    // `\d+px` 같은 느슨한 패턴으로 바꾸지 않는다 — 그러면 소리 없이 흔들린다.
    expect(globals, ".landing-tape가 크기를 고정하지 않는다").toMatch(
      /\.landing-tape\s*\{[^}]*font-size:\s*16px/u,
    );
    expect(globals, ".landing-tape가 웨이트를 고정하지 않는다").toMatch(
      /\.landing-tape\s*\{[^}]*font-weight:\s*700/u,
    );

    // 랜딩 블록은 @layer 밖에 있고(globals.css 1114~), cascade layer 규칙상 layer
    // 밖 선언은 Tailwind가 @layer utilities에 넣는 유틸리티를 **항상** 이긴다.
    // 그래서 테이프를 단 요소에 `text-[Npx]`를 같이 걸면 그 값은 렌더에 아무 영향이
    // 없고, 소스만 다른 크기를 약속한다. 옛 검사가 잡던 것과 같은 사고다 —
    // eyebrow 크기를 컴포넌트가 다시 선언하는 것. 웨이트도 같은 이유로 죽는다.
    for (const [file, src] of surfaces) {
      const lying = styleLiterals(src).filter(
        (c) =>
          hasUtility(c, "landing-tape")
          && (/text-\[\d+(?:\.\d+)?(?:px|rem)\]/u.test(c)
            || /(?<![\w-])font-(?:normal|medium|semibold|bold)(?![\w-])/u.test(c)),
      );
      expect(lying, `${file}: 테이프 eyebrow에 건 크기·웨이트는 .landing-tape가 이겨서 죽는다`).toEqual([]);
    }
  });

  it("keeps the closing CTA ahead of the account-beta conditions", () => {
    // 조건 네 개를 한 덩어리로 버튼 앞에 쌓으면 실측에서 페이지의 마지막 행동이
    // 접힘선 아래 53px(1280) · 266px(390)로 밀렸다. 지우지 않고 나눈 상태를 고정한다.
    //
    // 2026-08-27 재조준: `startConditions` 배열이 없어졌다. 조건은 이제
    // `landingContent.closing.note` 한 문단이고 통째로 버튼 **뒤**에 있다. 위치
    // 문제는 그래서 더 세게 풀렸다. 이 단언이 계속 지키는 것은 두 가지다.
    //  - 마지막 행동이 조건 더미에 밀리지 않는다(순서).
    //  - 조건이 사라지지 않는다 — 접근성·고지 의무는 위치가 아니라 존재다.
    const closing = sourceOf("ClosingAction.tsx");
    const bodyIndex = closing.indexOf("{closing.body}");
    const ctaIndex = closing.indexOf("{closing.primary.href}");
    const noteIndex = closing.indexOf("{closing.note}");

    expect(bodyIndex, "버튼 앞 설명 문단이 없다").toBeGreaterThan(-1);
    expect(ctaIndex, "마무리 CTA가 없다").toBeGreaterThan(-1);
    expect(noteIndex, "조건 문단이 없다").toBeGreaterThan(-1);
    expect(bodyIndex).toBeLessThan(ctaIndex);
    expect(ctaIndex).toBeLessThan(noteIndex);

    // 조건 세 가지가 전부 남아 있어야 한다. 옛 네 조건(0,1은 이 버튼이 여는 것,
    // 2,3은 계정 베타)이 한 문단으로 합쳐지면서 문장은 바뀌었지만 고지 내용은 같다.
    //
    // `closing` 블록을 먼저 잘라 낸 뒤 그 안의 note를 본다. 파일 전체에서 `note:`를
    // 찾으면 첫 note부터 파일 끝까지가 잡혀 **다른 섹션의 문장이 대신 답한다** —
    // 실제로 확인 섹션의 "계정 베타 기능이에요"가 마무리 조건인 척 통과했다.
    //
    // 2026-08-28: 옛 판은 정규식으로 블록을 잘라 놓고 `not.toBe("")` 로 지켰다.
    // 경계가 사라지면 빈 문자열이 아니라 **엉뚱한 범위**가 나오므로 그 가드는
    // 울지 않는다. 못 찾으면 던지는 `contentBlock()` 으로 갈아탔다.
    const closingBlock = contentBlock("closing", "footer");
    const note = /\bnote:\s*([\s\S]*)$/u.exec(closingBlock)?.[1] ?? "";
    expect(note, "마무리 조건 문단을 못 찾았다 — landingContent 구조가 바뀌었다").not.toBe("");
    for (const phrase of ["로그인 없이 열려요", "계정 베타", "결제를 요청하지 않아요"]) {
      expect(note.includes(phrase), `마무리 조건에서 "${phrase}"가 사라졌다`).toBe(true);
    }

    // 카피에 남아 있는 것과 화면이 그리는 것은 다른 질문이다. 조건 문단을 그리는
    // `<p>` 를 지우고 카피만 남겨도 위 검사는 전부 통과한다 — 그래서 렌더 쪽도 본다.
    expect(closing, "조건 문단을 그리는 <p> 가 없다").toMatch(/<p[^>]*>\{closing\.note\}<\/p>/u);
  });

  it("never puts a 44px touch target inline inside a paragraph", () => {
    // 44px 최소 높이를 문단 안 inline 요소에 주면 line box가 44px로 벌어져
    // 링크가 혼자 줄을 차지한다. WCAG 2.5.8도 문장 안 대상은 크기 요건에서 제외한다.
    // (옛 구조에는 이 자리를 위한 `inlineLink` 레시피가 있었다. 새 랜딩에는 문장
    //  안에 흐르는 링크가 없어 레시피는 사라졌지만, 금지는 그대로 유효하다.)
    for (const [file, src] of surfaces) {
      const paragraphs = [...src.matchAll(/<p\b[\s\S]*?<\/p>/gu)].map((m) => m[0]);
      for (const p of paragraphs) {
        expect(
          /min-h-11(?![\w-])|min-h-\[44px\]|min-h-\[2\.75rem\]/u.test(p),
          `${file}: 문단 안 링크에 44px를 주지 말고 문단 밖으로 꺼낸다`,
        ).toBe(false);
      }
    }
  });

  it("keeps structural borders to the named paper tokens", () => {
    // 도입 전에는 3개 역할에 18종의 테두리 토큰이 있었고, #243832의 /10·/12·/14·/16은
    // 합성하면 RGB 4단위 차이라 육안으로 구분되지 않았다.
    //
    // 2026-08-27 재조준: 새 랜딩은 알파를 섞지 않고 역할마다 이름 붙은 토큰을 쓴다.
    // 그래서 허용 목록이 "밝은 지면 /10·/14, 어두운 지면 /12·/18"에서 아래 다섯으로
    // 바뀌었다. 알파 접미사(`…)]/40`)가 다시 붙으면 그때부터 육안으로 구분 안 되는
    // 단계가 늘기 시작하므로 함께 막는다.
    //
    //   edge     지면 경계(헤더·섹션·카드 테두리)
    //   divider  목록·문단 구분선
    //   outline  보조 버튼 테두리
    //   ink      hover 강조
    //   pen      인용 곁블록의 왼쪽 규칙선
    //
    // 2026-08-28: 옛 정규식은 `border-` 바로 뒤에 색이 오는 형태만 봤다. 그래서
    // **변을 지정한 색**(`border-t-[var(--color-paper-mark)]`)이 통째로 빠져나갔다.
    // 변 지정을 받아들이되 색 자리만 떼어 내 같은 목록으로 잰다.
    const allowed = new Set([
      "[var(--color-paper-edge)]",
      "[var(--color-paper-divider)]",
      "[var(--color-paper-outline)]",
      "[var(--color-paper-ink)]",
      "[var(--color-paper-pen)]",
    ]);
    // 색 자리만 본다. `border-l-2`·`border-t`처럼 변·굵기를 정하는 유틸리티는
    // 색이 아니므로 팔레트 이름을 세 글자 이상으로 요구해 걸러 낸다(`l-2`가
    // `[a-z]+-\d+`에 걸려 색으로 세어진 적이 있다). arbitrary 값 중 길이만 적은
    // 것(`border-[1px]`)도 색이 아니므로 뺀다.
    const structural = new Map<string, string[]>();
    for (const [file, src] of surfaces) {
      for (const m of src.matchAll(
        /(?<![\w-])(?:border|divide)(?:-(?:[trblxyse]|top|bottom|left|right))?-(\[[^\]]+\]|white|black|current|transparent|[a-z]{3,}-\d+)(\/\d+)?(?![\w-])/gu,
      )) {
        const colour = m[1];
        if (colour.startsWith("[") && !/var\(|#|rgb|hsl/u.test(colour)) continue; // 길이 값
        if (allowed.has(colour) && !m[2]) continue;
        structural.set(m[0], [...(structural.get(m[0]) ?? []), file]);
      }
    }
    expect(
      [...structural.entries()].map(([t, f]) => `${t} (${[...new Set(f)].join(", ")})`),
      "구조 테두리는 이름 붙은 paper 토큰 다섯으로만 그린다(알파 변형 금지)",
    ).toEqual([]);
  });

  it("keeps every border radius on the DESIGN.md scale", () => {
    // DESIGN.md: sm 6, md 8, lg 12, xl 16, 2xl 20, 3xl 28, full.
    // Tailwind v4에는 20·28 스텝이 없어 arbitrary 표기가 유일한 방법이다.
    //
    // 2026-08-27 노트 개편은 종이 모서리로 `rounded-[3px]`를 11곳(6개 파일)에서
    // 썼다. DESIGN.md Layout 절의 라운드 스케일에는 그 값도, 랜딩 예외도 없었다.
    // **2026-08-28 재실측: 3px 는 컴포넌트 0곳 · globals.css 0곳**(`.landing-note`도
    // 6px 로 정렬됐다). 다시 나타나면 허용 집합에 3을 몰래 넣어 통과시키지 않는다 —
    // 고칠 곳은 DESIGN.md다.
    //
    // 2026-08-28: rem 표기(`rounded-[0.1875rem]`)도 같이 잰다.
    const allowed = new Set([6, 8, 12, 16, 20, 28]);
    for (const [file, src] of surfaces) {
      const off = [...src.matchAll(/rounded(?:-[a-z]{1,2})?-\[(\d+(?:\.\d+)?)(px|rem)\]/gu)]
        .filter((m) => !allowed.has(m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16))
        .map((m) => m[0]);
      expect(off, `${file}에 스케일 밖 라운드가 있다`).toEqual([]);
    }
  });

  it("reserves the 2px left rule for quoted sources", () => {
    // DESIGN.md 2026-08-05: 같은 `border-l-2`가 히어로에서는 출처(커플이 한 말),
    // PreparationResult에서는 목적지(반영된 기록)를 뜻해 의미가 정반대였다.
    // 규칙선은 "인용된 출처"에만 쓰고, 반영 결과는 sage로 표시하기로 했다.
    //
    // 2026-08-27: 히어로의 blockquote와 PreparationResult가 둘 다 없어졌다.
    // 랜딩에 남은 `border-l-2`는 하나뿐이고, 그것이 곧 "인용된 출처"다 —
    // 공시 가격 곁블록(한국소비자원 참가격을 옮겨 왔다고 말하는 자리).
    // sage 쪽 절반은 지킬 대상이 사라져 아래 존재 검사로 대체했다.
    const owners = surfaces
      .filter(([, s]) => s.includes("border-l-2"))
      .map(([name]) => name);
    expect(owners, "2px 규칙선은 인용 곁블록 하나만 쓴다").toEqual(["NotForVendorsSection.tsx"]);

    const aside = sourceOf("NotForVendorsSection.tsx");
    // 곁블록이지 본문이 아니다. `<aside>`가 아니게 되면 같은 표시가 다시 두 뜻을 진다.
    expect(aside, "인용 규칙선이 <aside> 밖으로 나갔다").toMatch(/<aside[^>]*border-l-2/u);
  });

  it("ornaments an eyebrow only where the ornament carries meaning", () => {
    // eyebrow 여덟 개에 장식이 네 종류(6px 점, 32px 규칙선 ×2, 16px 체크,
    // 48px 원형 메달리언) 섞이고 셋은 맨몸이었다. 뜻이 없는 장식은 섹션마다
    // 다른 격식을 만들 뿐이라 없앤다.
    //
    // 2026-08-27: 뜻을 지던 글리프 둘의 자리가 사라졌다 — 히어로는 eyebrow 자체가
    // 없어졌고(Sparkles = 아모라), 커뮤니티 안내 섹션은 컴포넌트가 삭제됐다
    // (BadgeCheck = 릴리스 경계). 그래서 "이 글리프는 남아야 한다" 절반은 지킬
    // 대상이 없다. 남은 절반 — 뜻 없는 장식 금지 — 은 그대로 지킨다.
    // 랜딩 전체의 lucide 글리프는 모바일 메뉴의 Menu·X 두 개뿐이고, 둘 다 eyebrow가
    // 아니라 버튼 아이콘이다.
    //
    // 2026-08-28: 옛 판은 `h-px w-8` 처럼 **폭까지 정확히** 적힌 것만, 그것도
    // `className="…"`(큰따옴표) 안에서만 찾았다. 폭을 `w-10` 으로 바꾸거나 템플릿
    // 리터럴 className 으로 옮기면 같은 장식이 그대로 통과했다. 이제 모양으로 잰다 —
    // 실선 한 줄(h-px + 폭)과 정원(rounded-full + 높이·폭)이 장식이다.
    for (const [file, src] of surfaces) {
      const decorations = styleLiterals(src).filter((c) => {
        // 머리카락 굵기(2px 이하)만 규칙선이다. `h-[150px]` 은 부케 그림 자리라
        // 장식 규칙선이 아니다 — 여기를 안 좁혔더니 꽃 SVG 가 걸렸다(2026-08-28).
        const rule = /(?<![\w-])h-(?:px|\[(?:0?\.5|1|1\.5|2)px\])(?![\w-])/u.test(c)
          && /(?<![\w-])w-\S+/u.test(c);
        const disc = hasUtility(c, "rounded-full")
          && /(?<![\w-])h-\S+/u.test(c)
          && /(?<![\w-])w-\S+/u.test(c);
        return rule || disc;
      });
      expect(decorations, `${file}: 뜻 없는 eyebrow 장식`).toEqual([]);
    }
  });

  it("never tries to centre an inline-flex recipe with mx-auto", () => {
    // 마무리 섹션의 CTA와 로그인 링크가 둘 다 `inline-flex`인데 각자 `mx-auto`로
    // 가운데 정렬한다고 믿고 있었다. inline 요소에 auto margin은 아무 일도 하지
    // 않으므로 둘은 같은 line box에 나란히 앉았고, 1280 실측에서 로그인 링크가
    // 버튼 위로 겹쳤다. 가운데 정렬과 세로 쌓기는 부모 컨테이너의 몫이다.
    //
    // 2026-08-27 재조준: 이름으로 부르던 레시피(primaryAction*·secondaryLink*)가
    // 없어져 심볼로는 못 찾는다. 대신 `inline-flex`와 `mx-auto`가 같은 클래스에
    // 함께 있는 경우를 전부 본다 — 레시피를 손으로 펼쳐 쓴 경우까지 잡히므로
    // 옛 검사보다 넓다.
    for (const [file, src] of surfaces) {
      const bad = styleLiterals(src).filter(
        (c) => c.includes("mx-auto") && c.includes("inline-flex"),
      );
      expect(bad, `${file}: inline-flex 요소에 mx-auto를 걸었다`).toEqual([]);
    }
  });
});
