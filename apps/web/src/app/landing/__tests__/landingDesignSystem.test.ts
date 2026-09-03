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
 *
 * ## 2026-08-29 재조준 — 랜딩이 정본 시안으로 다시 지어졌다
 *
 * `docs/landing/NotebookBest.html` 로 되돌리면서 섹션 구성이 통째로 바뀌었다.
 * 없어진 컴포넌트(ScenesSection · NoSideSection · OneRoomSection ·
 * PrivateLaneSection · NotForVendorsSection · PriceCompareSection)를 가리키던
 * 단언은 **지우지 않고**, 그 컴포넌트가 지고 있던 계약이 옮겨간 자리로 따라갔다.
 *
 * 표기가 바뀐 자리 둘이 특히 조용했다. 둘 다 이 파일의 옛 실패 방식 그대로다 —
 * 검사가 틀리는 게 아니라 **대상이 0개가 되면서 사라진다**.
 *
 *  - 밑줄 링크: `underline` 유틸리티 → globals.css `.landing-pen`(border-bottom).
 *  - 섹션 eyebrow: `<Section>` 의 테이프 → 자기 `<section>` 을 여는 섹션의 손글씨 한 줄.
 *
 * 이번에 새로 알게 된 빚 셋은 전부 이 파일 밖에서 고쳐야 해서 **인구조사로 못 박아**
 * 늘어나는 것만 막았다. 목록을 늘려 통과시키는 것이 곧 결정이다.
 *
 *  - **홀로 서는 링크가 44px 대상을 잃었다.** 옛 레시피는 `min-h-11` 을 요구했는데,
 *    새 랜딩의 `landing-pen` 링크 둘은 높이를 갖지 않는다(WCAG 2.5.8).
 *  - **본문 고정 크기가 스케일 밖으로 되돌아갔다**(15px 둘 · 17px 하나).
 *  - **홀로 서는 링크의 웨이트가 둘로 갈렸다**(semibold · medium).
 *
 * 그리고 **베타를 요구하던 단언은 지웠다** — 2026-08-29 파운더 결정으로 계정 베타라는
 * 틀 자체가 없어졌기 때문이다(CLAUDE.md: "베타 우리 안할거야 알아둬"). 없어진 것은
 * 틀이지 고지가 아니라서, 그 문장이 지고 있던 **비용·결제 고지는 아래에서 계속 지킨다**.
 * "베타가 화면에 없다" 쪽은 `landingSignupIsOpen.test.ts` 가 정본으로 들고 있다.
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

/**
 * 히어로의 **이어지는 장면**.
 *
 * 정본 시안에서 이 카드는 히어로와 같은 섹션 안에 있다(`AmoraNoteSection.tsx` 머리말).
 * 그래서 자기 eyebrow 도, 보이는 제목도, 위쪽 리듬도 갖지 않는다 — 히어로에 붙는다.
 * 예외를 **이름 하나로 못 박아** 두 번째가 생기면 아래 단언들이 울게 한다.
 */
const HERO_TAIL = "AmoraNoteSection.tsx";

/** 파일 안의 모든 문자열·템플릿 리터럴. className 이 어디에 적혔든 한 곳으로 모은다. */
const styleLiterals = (src: string) =>
  [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/gu)].map((m) => m[1] ?? m[2] ?? "");

/** 유틸리티 하나를 낱말 단위로 찾는다. `underline` 이 `underline-offset-4` 에 걸리지 않게. */
const hasUtility = (text: string, utility: string) =>
  new RegExp(
    String.raw`(?<![\w-])(?:[a-z0-9[\]().,%_-]+:)*` + utility + String.raw`(?![\w-])`,
    "u",
  ).test(text);

/** `import { … } from "./notebook"` 로 받아온 심볼. */
const importedSymbols = (src: string) =>
  new Set(
    (/import\s*\{([^}]*)\}\s*from\s*"\.\/notebook"/u.exec(src)?.[1] ?? "")
      .split(",")
      .map((s: string) => s.trim().replace(/^type\s+/u, ""))
      .filter(Boolean),
  );

/** import 구문을 걷어 낸 나머지 — 여기에 남아야 "실제로 쓴다". */
const bodyOf = (src: string) => src.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]*";/gu, "");

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
  const [hi, lo] = [luminance(a), luminance(b)].sort((x: number, y: number) => y - x);
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

/** `text-[clamp(a,b,c)]` 의 최대값(rem). 위계는 최대값끼리 비교해야 뒤집힘을 잡는다. */
const clampMaxRem = (text: string): number | null => {
  const m = /text-\[clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)\]/u.exec(text);
  return m ? Number(m[1]) : null;
};

describe("landing design system", () => {
  it("keeps looking at the sections the page really renders", () => {
    // 아래 단언들이 도는 대상 자체가 비어 버리면 전부 빈 통과가 된다.
    // 렌더 순서에서 뽑은 목록이 실제 파일과 이어지는지 먼저 못 박는다.
    //
    // 2026-08-29: 본문 섹션이 일곱에서 **다섯**으로 줄었다(정본 시안 복원 —
    // 아모라 노트 · 확인 · 커뮤니티 · 지금 되는 것 · 경계). 하한을 그 자리로 옮긴다.
    // 이 숫자는 "몇 개여야 한다"가 아니라 **대상이 비지 않았다**를 잰다.
    expect(bodySections.length, "본문 섹션을 못 찾았다 — page.tsx 구조가 바뀌었다")
      .toBeGreaterThanOrEqual(5);
    const files = new Set(landingComponentFiles());
    for (const file of bodySections) {
      expect(files.has(file), `${file}: page.tsx 가 그리는데 컴포넌트 파일이 없다`).toBe(true);
    }
    expect(renderedSections(), "히어로와 마무리는 페이지의 처음과 끝이다")
      .toEqual([HERO, ...bodySections.map((f: string) => f.replace(/\.tsx$/u, "")), CLOSING]);

    // 히어로 꼬리는 하나뿐이어야 한다 — 아래 여러 단언이 이 이름으로 예외를 통과시킨다.
    // 이 섹션이 페이지에서 사라지면 예외도 같이 지워야 하고, 그때 여기가 먼저 운다.
    expect(bodySections, `${HERO_TAIL} 이 사라졌다면 아래 예외들도 같이 지워야 한다`)
      .toContain(HERO_TAIL);
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
            ? digits.slice(0, 3).split("").map((d: string) => d + d).join("")
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
    // 정규식이 낡으면 0건을 세고도 통과한다(2026-08-28 실측 115건 · 2026-08-29 실측
    // 102건 — 섹션 여섯이 없어졌으니 줄어든 것이 맞다).
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
    // 정규식이 낡으면 0개를 세고도 통과한다. 하한을 둔다(2026-08-27 실측 12종 →
    // 2026-08-29 실측 11종, 섹션이 줄어 한 종이 안 쓰인다).
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
    //
    // ## 2026-08-29: 행동과 **그림**을 나눈다
    //
    // 옛 판은 확인 섹션의 그림 버튼("확인"·"나중에")을 진짜 행동과 한 통에 넣고 셌다.
    // 그때는 우연히 실루엣이 같아서 통과했지만, 정본 시안 복원으로 진짜 보조 버튼의
    // 글자색이 `ink-soft` → `ink` 로 올라가면서 그림 버튼만 옛 톤에 남았다.
    //
    // 그림 버튼은 **눌리지 않는 제품 화면 묘사**다(`ConfirmSection.tsx`: "진짜 버튼이
    // 아니다. 눌리지 않는 그림" · `aria-hidden`). 행동이 아니므로 "같은 행동은 같은
    // 물체" 계약의 대상이 아니다. 대신 **그림이 진짜와 다른 물체로 보이면 안 되므로**
    // 모서리·굵기는 진짜 레시피와 같아야 한다고 따로 못 박는다 — 옛 판에 없던 검사다.
    const drawnLiterals = new Set<string>(
      surfaces.flatMap(([, src]) =>
        [...src.matchAll(/<(div|span)\b[^>]*aria-hidden[^>]*>([\s\S]*?)<\/\1>/gu)].flatMap((m) =>
          styleLiterals(m[2]),
        ),
      ),
    );

    type Button = { file: string; cls: string };
    const real: Record<"ink" | "outline", Button[]> = { ink: [], outline: [] };
    const drawn: Button[] = [];
    for (const [file, src] of surfaces) {
      for (const c of styleLiterals(src)) {
        if (!c.includes("inline-flex")) continue;
        // ⚠️ 2026-08-29: 그림 버튼(aria-hidden)을 **진짜 버튼과 같은 잣대로** 골라내고
        // 있었다 — `ink` 바탕이거나 `outline` 테두리인 것만. 그래서 확인 섹션의 "나중에"
        // 칩 테두리를 장식용 `edge` 로 옮기자(그건 컨트롤이 아니므로 맞는 이동이다)
        // 그림 버튼이 2개에서 1개로 줄었고, "aria-hidden 이 사라졌나" 라는 **틀린 이유**로
        // 실패했다. 그림 버튼은 무엇으로 그렸든 그림이다 — 종이 토큰을 쓰면 센다.
        const isDrawn = drawnLiterals.has(c);
        if (isDrawn) {
          if (/(?:bg|border)-\[var\(--color-paper-/u.test(c)) drawn.push({ file, cls: c });
          continue;
        }
        const kind = c.includes("bg-[var(--color-paper-ink)]")
          ? "ink"
          : c.includes("border-[var(--color-paper-outline)]")
            ? "outline"
            : null;
        if (!kind) continue;
        real[kind].push({ file, cls: c });
      }
    }
    // 실측(2026-08-29): 진짜 잉크 버튼 3개(헤더 시작하기 · 히어로 · 마무리),
    // 진짜 테두리 버튼 3개(히어로 · 커뮤니티 · 마무리), 그림 버튼 2개(확인 섹션).
    // 정규식이 낡아 0개를 세고 통과하는 것을 막는다.
    // 2026-09-03: 셋에서 둘로 줄었다(헤더 · 히어로). 마무리 버튼은 어두운 띠 위라
    // 색이 뒤집혔다 — 잉크 바탕에 잉크 버튼은 보이지 않는다. 같은 물체이고 **지면이
    // 다를 뿐**이며, 아래 실루엣 검사가 둘을 같은 모양으로 계속 묶는다.
    expect(real.ink.length, "기본 행동 버튼을 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(2);
    // 2026-09-03: 셋에서 둘로 줄었다. 마무리의 테두리 버튼이 시안대로 **글자 링크**가
    // 됐다 — 어두운 띠 위에서 버튼 둘을 나란히 두면 무엇을 먼저 눌러야 할지가 흐려진다.
    // 하한은 "정규식이 낡아 0개를 세고 통과하는 것"을 막는 장치이고, 실제 개수를 못
    // 박는 것은 아래 실루엣 단언이다.
    expect(real.outline.length, "보조 버튼을 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(2);
    // 2026-09-03: 둘에서 넷으로. 확인 카드의 버튼이 둘("확인"·"나중에")에서
    // 셋("맞아요"·"수정하기"·"지금은 저장 안 함")이 됐고, 아모라 카드에 고르는 칩
    // 둘이 새로 생겼다. **전부 눌리지 않는 그림이라 `aria-hidden` 이어야 한다** —
    // 개수를 못 박아 두면 그림이 하나 늘 때마다 사람이 그 사실을 본다.
    expect(drawn.length, "그림 버튼 개수가 바뀌었다 — aria-hidden 이 사라졌나").toBe(4);

    /** [모서리, 웨이트, 글자색] — 자리마다 달라도 되는 크기는 일부러 안 본다. */
    const silhouette = (c: string) => [
      /rounded-\[[^\]]+\]|rounded-(?:none|sm|md|lg|xl|2xl|3xl|full)/u.exec(c)?.[0] ?? "(모서리 없음)",
      /font-(?:normal|medium|semibold|bold)/u.exec(c)?.[0] ?? "(웨이트 없음)",
      /text-\[var\(--color-paper-[a-z-]+\)\]/u.exec(c)?.[0] ?? "(글자색 없음)",
    ];

    for (const [label, buttons] of [
      ["기본 행동", real.ink],
      ["보조 행동", real.outline],
    ] as const) {
      const shapes = new Map<string, string[]>();
      for (const { file, cls } of buttons) {
        const key = silhouette(cls).join(" ");
        shapes.set(key, [...(shapes.get(key) ?? []), file]);
      }
      expect(
        [...shapes.entries()].map(([s, f]) => `${s} ← ${[...new Set(f)].join(", ")}`),
        `${label} 버튼이 두 가지 이상의 실루엣으로 그려졌다`,
      ).toHaveLength(1);
    }

    // 그림은 진짜와 같은 물체로 읽혀야 한다 — 톤만 조용할 수 있고 모양은 같다.
    const realShape = silhouette(real.ink[0].cls).slice(0, 2);
    for (const { file, cls } of drawn) {
      expect(
        silhouette(cls).slice(0, 2),
        `${file}: 그림 버튼이 진짜 버튼과 다른 모서리·굵기다 — 화면 묘사가 거짓이 된다`,
      ).toEqual(realShape);
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

    // 2026-08-29: 정본 시안 복원으로 본문 섹션이 <Section> 하나로만 오지 않는다.
    // 셋은 자기 <section> 을 열고 `band` 를 직접 얹는다(자기 eyebrow 표기를 쓰기
    // 때문이다). **지키는 것은 "Section 컴포넌트를 쓰는가"가 아니라 "같은 리듬을
    // 받는가"** 이므로 둘 중 하나면 된다고 잰다. 예외는 히어로 꼬리 하나뿐이고,
    // 그 하나를 이름으로 못 박는다 — 예외가 늘면 리듬이 다시 흩어진다.
    const withoutBand: string[] = [];
    for (const file of bodySections) {
      const src = sourceOf(file);
      const shared = /<Section[\s>]/u.test(src) || importedSymbols(src).has("band");
      if (!shared) withoutBand.push(file);
    }
    // 2026-09-03: 예외가 없어졌다. 히어로 꼬리(아모라 노트 카드)가 시안에서 **자기
    // 섹션**이 되면서 공유 리듬을 받는다. **비어 있는 것이 맞는 상태다** — 여기에
    // 이름을 더하는 것이 곧 "리듬을 하나 더 만든다"는 결정이다.
    expect(withoutBand, "본문 섹션이 <Section> 도 band 도 없이 자기 리듬을 정했다").toEqual([]);

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
      // 공유 한 단계. 본문 섹션 넷과 마무리가 전부 이걸 지난다.
      // 2026-08-29: 마무리가 자기 단계(py-20 / sm:py-28)를 버리고 band 로 들어왔다 —
      // 단계가 둘에서 **하나로 줄었다**. 되돌아가면 여기가 운다.
      // 2026-09-03: 같은 한 걸음을 **위아래로 나눠 쓰는** 변형 둘이 늘었다
      // (`bandTop`/`bandBottom`). 끝 다크 밴드의 두 섹션이 사이에 152px 을 두지 않고
      // 한 덩어리로 이어지게 하려는 것이고, **값은 늘지 않았다** — 76px 그대로다.
      "notebook.tsx": [
        "pb-14",
        "pt-14",
        "py-14",
        "sm:pb-[76px]",
        "sm:pt-[76px]",
        "sm:py-[76px]",
      ],
      // 히어로는 부케 자리 때문에 위아래가 비대칭이다. 값은 고정하되 대칭은 요구하지 않는다.
      "TransformationHero.tsx": ["pb-16", "sm:pt-14"],
      // 2026-09-03: 아모라 카드가 자기 섹션이 되면서 공유 리듬(`band`)으로 들어왔다 —
      // 여기서 이름이 빠진 것은 **단계가 하나 줄었다**는 뜻이다.
      // 사진 자리는 안쪽 점선 상자의 여백이다(섹션 리듬이 아니라 상자 안쪽).
      "PhotoBandSection.tsx": ["py-12"],
      // 푸터는 섹션이 아니라 페이지를 닫는 띠다.
      "LandingFooter.tsx": ["py-14"],
    });

    // `<section>`을 직접 여는 파일이 늘면 리듬이 다시 흩어진다 — 390px에서 5종,
    // 1280px에서 6종까지 갔던 적이 있다.
    //
    // 2026-08-29: 셋에서 일곱으로 늘었다. 늘어난 넷 중 셋(커뮤니티·지금 되는 것·경계)은
    // `band` 를 직접 얹으므로 리듬은 그대로다 — 위 `withoutBand` 가 그것을 잰다.
    // 여기서는 **누가 열었는지**를 계속 못 박는다. 이름이 늘면 리뷰어가 본다.
    const rawSections = components
      .filter(([, s]) => /<section[\s>]/u.test(s))
      .map(([name]) => name)
      .sort();
    expect(rawSections, "새 섹션이 <Section>을 지나지 않고 자기 <section>을 열었다").toEqual([
      // 2026-09-03: 일곱에서 열하나로. 시안이 섹션마다 2단 배치·전면 띠·흰 카드처럼
      // `<Section>` 한 모양으로는 못 그리는 구조를 요구한다. **리듬은 그대로다** —
      // 넷 다 `band` 를 얹고, 위 `withoutBand` 가 그것을 매번 확인한다.
      "AmoraNoteSection.tsx",
      "AvailableNowSection.tsx",
      "BlockedReasonsSection.tsx",
      "BoundariesSection.tsx",
      "ClosingAction.tsx",
      "CommunitySection.tsx",
      "ConfirmSection.tsx",
      "NoSideSection.tsx",
      "PhotoBandSection.tsx",
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
    // 2026-08-28 재실측: 0곳.
    //
    // 2026-08-28: px 만 봐서 `text-[1.19rem]`(=19px)이 빠져나갔다. rem 도 같이 잰다.
    // `em`·`%`·`ch` 는 부모 크기에 딸린 상대값이라 스케일로 잴 수 없다 —
    // 지금 랜딩에 하나 있고(`Circled` 의 `text-[1.05em]`) 그건 장식의 광학 보정이다.
    //
    // ## 2026-08-29: 손글씨와 본문을 나눠 센다
    //
    // DESIGN.md 의 스케일은 **Paperlogy 의** 스케일이다("Brand font: Paperlogy" 바로
    // 아래 줄). 손글씨 Gaegu 는 같은 문서의 "Landing handwriting exception" 으로 들어온
    // 다른 서체이고, **같은 px 에서 Paperlogy 보다 작아 보인다** — globals.css 가
    // `.landing-tape` 를 12px 에서 16px 로 올린 이유가 그것이고 거기 적혀 있다.
    // 그래서 손글씨 크기를 Paperlogy 스케일로 재는 것은 처음부터 틀린 자였다.
    //
    // 대신 손글씨도 **아무 값이나 쓸 수는 없다** — 쓰이는 값을 통째로 못 박아 늘어나는
    // 것을 막는다. 본문 쪽은 스케일 밖 값이 셋 되돌아왔다(15px 둘 · 17px 하나).
    // 그건 빚이고 고칠 곳은 이 파일 밖이다 — 컴포넌트의 값을 스케일로 되돌리거나,
    // DESIGN.md 에 랜딩 타입 스케일 예외를 적는 것. 여기서는 **정확히 이 셋만**
    // 통과시켜 더 늘지 못하게 한다. 목록을 늘려 통과시키는 것이 곧 결정이다.
    const allowed = new Set([12, 14, 16, 18, 20, 24, 30, 36, 48]);
    const SIZE = /text-\[(\d+(?:\.\d+)?)(px|rem)\]/gu;

    const handOff = new Map<string, string[]>();
    const bodyOff = new Map<string, string[]>();
    for (const [file, src] of surfaces) {
      // 리터럴로 나눠 세면서, 리터럴 밖으로 새는 표기가 없는지 개수로 대조한다.
      // 표기가 바뀌어 리터럴 스캔이 놓치면 여기가 운다 — 조용한 0건을 막는 자리다.
      let counted = 0;
      for (const c of styleLiterals(src)) {
        const hand = hasUtility(c, "landing-hand");
        for (const m of c.matchAll(SIZE)) {
          counted += 1;
          const px = m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
          if (allowed.has(px)) continue;
          const bucket = hand ? handOff : bodyOff;
          const key = `${px}px`;
          bucket.set(key, [...(bucket.get(key) ?? []), file]);
        }
      }
      const inSource = [...src.matchAll(SIZE)].length;
      expect(counted, `${file}: 클래스 리터럴 밖에 고정 크기가 적혔다 — 스캔이 못 본다`)
        .toBe(inSource);
    }

    // 본문(Paperlogy) — 스케일 밖은 아래 셋뿐이고, 셋 다 되돌려야 할 빚이다.
    expect(
      Object.fromEntries(
        [...bodyOff.entries()].map(([px, f]) => [px, [...new Set(f)].sort()]),
      ),
      "크기로 위계를 만들지 말고 웨이트를 쓴다 — 허용 목록을 늘려 통과시키지 마라",
    // 2026-08-29: 여기 세 항목이 빚으로 올라와 있었다(17px 하나 · 15px 둘). 셋 다
    // 같은 날 새로 만든 컴포넌트가 낸 것이라 되돌리는 편이 맞았다 — 카드 제목은
    // 18px(lg), 펜 링크 둘은 16px(base). `ConfirmSection` 이 13px 을 더하려 해서
    // 이 검사가 울었고, 목록을 늘리는 대신 그것도 14px(sm)로 되돌렸다.
    // **비어 있는 것이 맞는 상태다.** 여기에 항목을 더하는 것이 곧 결정이다.
    ).toEqual({});

    // 손글씨(Gaegu) — 광학 보정이라 Paperlogy 스케일 밖이 맞다. 값 자체를 못 박는다.
    expect(
      Object.fromEntries(
        [...handOff.entries()].map(([px, f]) => [px, [...new Set(f)].sort()]),
      ),
      "손글씨 크기가 늘었다 — Gaegu 는 광학 보정을 받지만 값은 이 목록이 정본이다",
    // 2026-09-03: **비었다.** 시안이 섹션 눈썹을 전부 한 격식(12px 산세리프 로즈)으로
    // 모으면서, 손글씨가 크기를 정하는 자리가 컴포넌트에서 사라졌다. 남은 손글씨는
    // globals.css 가 크기를 쥔 것들뿐이다(`.landing-tape` 16px · `.landing-hand` 상속).
    // 값이 다시 생기면 그건 "컴포넌트가 손글씨 크기를 스스로 정하기 시작했다"는 뜻이다.
    ).toEqual({});
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
    // 2026-09-03: 여덟에서 여섯으로 줄었다. 섹션 눈썹 넷이 손글씨를 놓고 12px 산세리프
    // 한 격식으로 모였기 때문이다(시안). 굵은 채널은 사라지지 않았다 — `eyebrowText` 의
    // `font-semibold` 가 그 자리를 이어받고, 바로 아래 두 단언이 그것을 센다.
    ).toBeGreaterThanOrEqual(5);
    expect(count("font-medium")).toBeGreaterThanOrEqual(3);
    expect(count("font-semibold")).toBeGreaterThanOrEqual(3);
  });

  it("draws every section eyebrow and lede from one shared recipe", () => {
    // 옛 구조: landingType.ts의 sectionEyebrow/sectionLede 문자열을 섹션이 각자 붙였다.
    // 새 구조: eyebrow는 <Section>이 테이프 이름표로 그리거나, 자기 <section>을 여는
    // 섹션이 손글씨 한 줄로 그린다. 본문 문체는 notebook.tsx의 bodyText/noteText/ruled가
    // 맡는다. 지키는 것은 같다 — 같은 층위의 라벨과 본문이 섹션마다 다른 격식으로
    // 읽히지 않게 하는 것.
    for (const sym of [
      "export const bodyText",
      "export const noteText",
      "export const ruled",
      "export const sectionTitle",
    ]) {
      expect(notebook, `${sym}이 없다`).toContain(sym);
    }

    // 테이프가 쓰이는 자리를 못 박는다. 옛 판은 "<Section> 밖에서 그리면 안 된다"였는데,
    // 2026-08-29 정본 시안 복원으로 테이프가 두 역할을 더 맡았다. 자리를 적어 둔다 —
    // 새 파일이 테이프를 집어 들면 여기가 운다.
    const tapeOwners = surfaces
      .filter(([, s]) => s.includes("landing-tape"))
      .map(([n]) => n)
      .sort();
    expect(tapeOwners, "테이프 이름표를 새로운 자리에서 다시 그렸다").toEqual([
      // 카드 번호 01~04. eyebrow 가 아니라 목록 표시다.
      "AvailableNowSection.tsx",
      // 페이지 맨 위 한 장 — "아모라 · 대화를 정리하는 AI".
      "TransformationHero.tsx",
      // <Section> 의 eyebrow.
      "notebook.tsx",
    ]);

    // ## 2026-09-03 — 눈썹이 **한 격식**이 됐다
    //
    // 옛 구조는 둘이었다: `<Section>` 은 노란 테이프 이름표, 자기 `<section>` 을 여는
    // 섹션은 손글씨 19px. 시안이 전부 **12px 굵은 산세리프, 흐린 로즈브라운**으로
    // 모았고, 공용 상수 `eyebrowText` 하나가 그것을 쥔다.
    //
    // 그래서 검사도 바뀐다 — "손글씨 실루엣이 하나인가" 에서 **"눈썹을 그리는 자리가
    // 전부 그 상수를 쓰는가"** 로. 값을 손으로 다시 적는 순간 여기가 운다.
    expect(notebook, "공용 눈썹 상수가 없다").toContain("export const eyebrowText");
    const eyebrowRecipe = /"text-\[12px\] font-semibold text-\[var\(--color-rose-600\)\]"/u;
    expect(notebook, "눈썹 레시피가 바뀌었다 — 값을 옮기면 이 검사도 옮겨라")
      .toMatch(eyebrowRecipe);

    // 눈썹 카피(`*.eyebrow`)를 그리는 파일은 전부 그 상수를 쓴다.
    const eyebrowOwners = surfaces
      .filter(([, src]) => /\.eyebrow\}/u.test(src))
      .map(([name, src]) => [name, src] as const);
    expect(eyebrowOwners.length, "눈썹을 그리는 파일을 하나도 못 찾았다 — 표기가 바뀌었다")
      .toBeGreaterThanOrEqual(4);
    const handRolled = eyebrowOwners
      .filter(([, src]) => !src.includes("eyebrowText"))
      .map(([name]) => name);
    expect(handRolled, "눈썹을 공용 상수 없이 손으로 그린 파일").toEqual([]);

    // 값을 상수 밖에서 다시 적는 것도 막는다 — 상수를 import 해 놓고 옆에 같은 값을
    // 인라인으로 적으면 위 검사는 통과하지만 격식이 둘로 갈린다.
    for (const [name, src] of surfaces) {
      if (name === "notebook.tsx") continue;
      expect(src, `${name} 이 눈썹 값을 손으로 다시 적었다`).not.toMatch(eyebrowRecipe);
    }

    // 2026-08-28: 옛 판은 `source.includes("bodyText")` 였다. 그래서 **import 만
    // 지우고 사용을 남겨도** 통과했고(컴파일은 깨지는데 테스트는 초록),
    // 반대로 **import 만 남기고 사용을 지워도** 통과했다. 둘을 나눠 본다.
    //
    // 2026-08-29: 옛 판은 모든 본문 섹션에 `bodyText` 를 요구했는데, 새 구조에서
    // 카드 안의 글줄은 `ruled`(32px 줄 간격)를 쓰고 흐르는 문단만 `bodyText` 를
    // 쓴다 — 카드만 있는 섹션에는 흐르는 문단이 없다. 그래서 **다섯 섹션이 전부
    // 갖는 것**으로 자리를 옮긴다: 작은 글씨(고지·단서)의 문체 `noteText`.
    // 이건 느슨해진 게 아니다. 작은 글씨는 이 랜딩에서 **고지가 사는 자리**이고,
    // 그 문체가 섹션마다 갈리면 고지가 장식처럼 읽힌다.
    for (const file of bodySections) {
      const src = sourceOf(file);
      const imported = importedSymbols(src);
      const body = bodyOf(src);

      // 2026-09-03: 지면이 하나 늘어(끝 다크 밴드) 같은 문체의 잉크 위 짝이 생겼다.
      // 둘은 크기·행간이 같고 색만 다르다 — `noteTextOnInk` 도 같은 문체로 친다.
      const noteStyle = ["noteText", "noteTextOnInk"].filter((sym: string) => imported.has(sym));
      expect(noteStyle, `${file}이 notebook에서 작은 글씨 문체를 받아오지 않는다`).not.toHaveLength(0);
      expect(
        noteStyle.some((sym: string) => body.includes(sym)),
        `${file}이 작은 글씨 문체를 import만 하고 쓰지 않는다`,
      ).toBe(true);

      // eyebrow 는 카피 정본이 갖고 있고 섹션이 그린다. 예외를 **이름으로** 적는다 —
      // 조건으로 적으면 조용히 넓어진다.
      //
      //   히어로 꼬리(아모라 노트)  히어로에 붙은 카드라 자기 이름표가 없다.
      //   경계(다크 밴드 위쪽)      2026-09-03 시안에 eyebrow 가 없다. 어두운 띠가
      //                            이미 "여기부터 다른 이야기"를 말한다.
      // 2026-09-03: 히어로 꼬리가 자기 눈썹을 갖게 됐다(시안의 "막막한 그대로 말해도
      // 돼요"). 눈썹이 없는 자리는 둘 — 어두운 띠의 경계 섹션과, 카드가 스스로 경계를
      // 만드는 커뮤니티 섹션이다.
      const NO_EYEBROW = new Set([
        "BoundariesSection.tsx",
        "CommunitySection.tsx",
        "PhotoBandSection.tsx",
      ]);
      if (!NO_EYEBROW.has(file)) {
        expect(body.includes(".eyebrow"), `${file}이 카피의 eyebrow를 그리지 않는다`).toBe(true);
      } else {
        expect(body, `${file}이 예외 목록에 있는데 eyebrow 를 그린다`).not.toContain(".eyebrow");
      }

      // 보이는 h2 는 공유 스케일을 쓴다. 랜드마크 이름용 sr-only h2 는 표시 타입이 아니다.
      for (const h2 of [...src.matchAll(/<h2\b[\s\S]*?>/gu)].map((m) => m[0])) {
        const shared = h2.includes("sectionTitle") || h2.includes("sr-only");
        expect(shared, `${file}: h2 가 공유 sectionTitle 을 쓰지 않고 자기 크기를 정했다`).toBe(true);
      }
    }

    // 흐르는 디스플레이 타입(clamp)은 공유 스케일의 몫이다. 섹션이 자기 clamp 를
    // 적기 시작하면 본문 곡선이 섹션마다 갈린다 — 손으로 적은 `text-[19px]
    // leading-[1.9]` 가 그 시작이었다(2026-08-28 변형). 소유자를 못 박는다.
    const clampOwners = surfaces
      .filter(([, s]) => s.includes("text-[clamp("))
      .map(([n]) => n)
      .sort();
    expect(clampOwners, "흐르는 타입은 notebook 의 공유 스케일 · H1 · 마무리 한 줄만 정한다").toEqual([
      // 2026-09-03: 마무리가 빠졌다. 시안의 마무리 제목이 손글씨 한 줄에서 **본문 서체
      // 두 줄**로 바뀌면서 자기 clamp 를 버리고 공유 `sectionTitleOnInk` 를 쓴다 —
      // 소유자가 셋에서 둘로 **줄었다**.
      "TransformationHero.tsx",
      "notebook.tsx",
    ]);

    // 이름을 적는 것만으로는 위계가 지켜지지 않는다 — 옛 사고(2026-08-05)는 h2 가
    // H1 보다 커진 것이었다(1280px 에서 H1 68px < 마무리 h2 73.6px). **최대값끼리**
    // 재서 그 역전을 직접 막는다. 2026-08-29 에 마무리가 자기 clamp 를 갖게 됐으니
    // 그 자리도 같이 잰다.
    //
    // 2026-09-03: 마무리가 자기 clamp 를 버리고 `sectionTitleOnInk` 를 쓴다. 그래서
    // "마무리 ≤ 섹션 제목" 은 잴 것이 없어졌다 — **같은 곡선이라 구조적으로 참**이다.
    // 대신 그 사실을 여기서 못 박는다(마무리가 다시 자기 크기를 정하면 위 소유자
    // 목록이 먼저 운다).
    const heroMax = clampMaxRem(sourceOf("TransformationHero.tsx"));
    const sectionMax = clampMaxRem(notebook);
    expect(heroMax, "히어로 H1 의 clamp 최대값을 못 읽었다").not.toBeNull();
    expect(sectionMax, "sectionTitle 의 clamp 최대값을 못 읽었다").not.toBeNull();
    expect(sectionMax as number, "h2 가 H1 보다 커지면 위계가 뒤집힌다")
      .toBeLessThan(heroMax as number);
    expect(
      sourceOf("ClosingAction.tsx"),
      "마무리가 공유 제목 곡선을 쓰지 않는다",
    ).toContain("sectionTitleOnInk");

    // 12px 라벨은 4.5:1이 필요하다. 옛 eyebrow(rose-600 on ivory-blush)가 4.13:1로
    // 미달해서 rose-700으로 올렸던 자리다. 지면이 테이프로 바뀌었으니 대비는 처음부터
    // 다시 계산돼야 한다 — `.landing-tape`는 16px/700이라 WCAG 큰 글자 예외
    // (18.66px 이상 굵은 글씨)를 여전히 받지 못한다.
    expect(contrast(hexOf("--color-paper-tape-ink"), hexOf("--color-paper-tape"))).toBeGreaterThanOrEqual(4.5);
  });

  it("draws every standalone secondary link from one recipe", () => {
    // 옛 구조: secondaryLink / secondaryLinkOnDark / inlineLink 세 상수.
    // 새 랜딩에는 어두운 지면이 없어졌고(전부 종이 위다) on-dark 갈래는 지킬 대상이
    // 사라졌다. 문단 안 44px 금지는 아래 별도 단언이 계속 지킨다.
    //
    // 남은 것은 문장 밖에 홀로 서는 링크다. 공유 심볼이 없으니 기본 행동 버튼과
    // 같은 방법으로 잰다: 같은 역할은 같은 실루엣이어야 한다.
    //
    // 2026-08-28: 옛 판은 `underline && inline-flex` 둘 다 가진 클래스만 골랐다.
    // 그래서 **`inline-flex` 없이 새로 조립한 밑줄 링크**는 다섯 토큰을 하나도 안
    // 지켜도 검사 대상이 아니었다.
    //
    // ## 2026-08-29: 밑줄의 표기가 바뀌었다 — `underline` 은 이제 0곳이다
    //
    // 정본 시안의 링크 밑줄은 유틸리티가 아니라 globals.css 의 `.landing-pen`
    // (파란 펜 `border-bottom: 2px`)이다. `underline` 만 찾던 옛 판은 **0개를 세고
    // 하한에서 멈췄다** — 표기가 바뀌면 검사가 조용히 사라진다는, 이 파일의 옛
    // 실패 방식 그대로다. 그래서 "밑줄"을 뜻으로 다시 정의한다: `.landing-pen`.
    // 전제를 가정하지 않고 먼저 확인한다 — 저 클래스가 밑줄을 안 그리면 이 재조준이
    // 성립하지 않는다.
    expect(globals, ".landing-pen 이 밑줄을 그리지 않는다 — 이 검사의 전제가 깨졌다").toMatch(
      /\.landing-pen\s*\{[^}]*border-bottom:\s*2px/u,
    );

    // "홀로 선다"도 뜻으로 잰다 — `<p>` 를 열자마자 링크가 오면 그 문단은 링크
    // 하나짜리다(문장 안에 흐르는 링크는 앞에 글자가 먼저 온다).
    // ⚠️ 2026-08-29: 이 탐지가 `<p>` 로 시작하고 className 이 **인라인 문자열**인
    // 경우만 잡았다. 그래서 링크 하나가 토큰 하나로 빠져나간다 —
    // `<div><Link className={cx(...)}>` 로 쓰면 검사 대상이 아예 아니게 된다.
    //
    // 처음에는 래퍼를 `<p|div|li>` 로 넓혔는데 **그건 버튼과 내비까지 삼켰다**
    // (히어로 CTA 둘·푸터 링크 목록·헤더 내비 — 전부 자기 레시피가 따로 있는
    // 다른 종류다). 래퍼는 이 링크가 무엇인지 말해 주지 않는다.
    //
    // 그래서 표식으로 판정한다: **파란 펜 밑줄(`landing-pen`)을 단 상호작용 요소**가
    // 이 레시피의 대상이다. 바로 아래 검사가 "밑줄은 누를 수 있는 것에만"을 지키므로
    // 두 정의가 서로를 받쳐 준다. 래퍼를 바꿔도 빠져나갈 수 없다.
    const PEN_LINK = /<(?:Link|TrackedLandingLink|a)\b([^>]*?)>/gu;
    const inlineClass = (attrs: string) =>
      /className="([^"]*)"/u.exec(attrs) ?? /className=\{`([^`]*)`\}/u.exec(attrs);

    const links: Array<readonly [string, string]> = [];
    const unreadable: string[] = [];
    for (const [file, src] of surfaces) {
      // 문장 안에 흐르는 펜 링크는 다른 종류다(높이를 가지면 안 된다). 그런 링크가
      // 사는 문단은 링크 말고도 글자를 갖는다 — 그 문단의 링크는 여기서 뺀다.
      const inSentence = new Set<string>();
      for (const [paragraph] of src.matchAll(/<p\b[\s\S]*?<\/p>/gu)) {
        const besides = paragraph
          .replace(/<(?:Link|TrackedLandingLink|a)[\s>][\s\S]*?<\/(?:Link|TrackedLandingLink|a)>/gu, "")
          .replace(/<[^>]*>/gu, "")
          .trim();
        if (besides === "") continue;
        for (const [, attrs] of paragraph.matchAll(PEN_LINK)) inSentence.add(attrs);
      }

      for (const [, attrs] of src.matchAll(PEN_LINK)) {
        // 2026-09-03: 표식이 둘이 됐다. 종이 위에서는 파란 펜 밑줄(`landing-pen`),
        // 잉크 위에서는 보통 밑줄(`underline`)이다 — 펜 파랑(#35638A)은 잉크 바탕에서
        // 1.9:1 이라 아예 안 보인다. **표식은 여전히 "밑줄"** 이고, 지면이 늘어난 것이다.
        if (!/landing-pen|(?<![\w-])underline(?![\w-])/u.test(attrs)) continue;
        if (inSentence.has(attrs)) continue;
        const found = inlineClass(attrs);
        if (found) links.push([file, found[1]] as const);
        else if (/className=\{/u.test(attrs)) {
          unreadable.push(`${file}: className={…} 로 조립한 홀로 서는 링크`);
        }
      }
    }
    expect(
      unreadable,
      "홀로 서는 링크의 클래스를 표현식으로 조립하면 레시피를 대조할 수 없다 — "
        + "문자열로 적어라.",
    ).toEqual([]);
    expect(links.length, "홀로 서는 링크를 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(2);

    // 위반을 모아서 한 번에 단언한다. 링크마다 즉시 던지면 **먼저 나온 위반 하나가
    // 나머지를 가린다** — 실제로 그것 때문에 새로 심은 위반이 안 보였다(2026-08-28).
    const offenders: string[] = [];
    for (const [file, c] of links) {
      // 지면마다 레시피가 하나씩이다. 어느 지면인지는 **색**이 말한다.
      //
      // 2026-08-29: 레시피가 `text-[15px]` 였다. 15px 은 DESIGN.md 스케일 밖이라
      // 바로 위 타입 검사가 같은 값을 "빚"으로 부르고 있었다 — 가드 둘이 서로 다른
      // 값을 요구하면 어느 쪽을 맞춰도 다른 쪽이 깨진다. 스케일에 있는 값으로 통일.
      const onInk = c.includes("--color-paper-on-ink");
      const missing = (onInk
        ? ["underline", "text-[14px]", "text-[var(--color-paper-on-ink-faint)]"]
        : ["landing-pen", "text-[16px]", "text-[var(--color-paper-ink)]"]
      ).filter((token: string) => !c.includes(token));
      if (missing.length > 0) offenders.push(`${file}: ${missing.join(", ")} 없음`);
    }
    expect(offenders, "홀로 서는 링크를 레시피 없이 새로 조립했다").toEqual([]);

    // 토큰이 다 있어도 조합이 갈릴 수 있다. 실루엣을 마지막으로 본다.
    //
    // **여기에 빚이 둘 있다.** 늘어나는 것만 막고, 고치는 것은 이 파일 밖이다.
    //  1. 웨이트가 semibold/medium 둘로 갈렸다 — 같은 역할인데 두 격식이다.
    //  2. **44px 대상이 사라졌다.** 옛 레시피는 `min-h-11` 을 요구했다(WCAG 2.5.8 —
    //     문장 밖 링크는 크기 요건을 받는다). 새 링크 둘 다 높이를 갖지 않는다.
    //     `(높이 없음)` 이 그 빈자리를 눈에 보이게 적어 둔 것이다. 지워서 통과시키지
    //     마라 — 지우면 44px 가 사라진 사실 자체가 이 파일에서 없어진다.
    const shapes = new Map<string, string[]>();
    for (const [file, c] of links) {
      const key = [
        /(?<![\w-])font-(?:normal|medium|semibold|bold)(?![\w-])/u.exec(c)?.[0] ?? "(웨이트 없음)",
        /(?<![\w-])min-h-\S+/u.exec(c)?.[0] ?? "(높이 없음)",
      ].join(" ");
      shapes.set(key, [...(shapes.get(key) ?? []), file].sort());
    }
    expect(
      Object.fromEntries(shapes),
      "홀로 서는 링크의 실루엣이 늘었다 — 늘리기 전에 왜 같은 역할이 다른 물체인지 적어라",
    // 2026-08-29: 위에 적혀 있던 빚 둘을 갚았다.
    //  1. 웨이트가 semibold/medium 으로 갈려 있던 것을 `font-medium` 하나로. 둘은 같은
    //     역할(문장 밖 보조 링크)이고, 보조 링크가 본문보다 굵을 이유가 없다.
    //  2. `min-h-11` 을 되돌렸다. 실측 22px 이라 WCAG 2.5.8 의 AA 최소(24px)에도 못
    //     미쳤다. 아래 "문단 안 44px 금지"는 **문장 안** 링크만 막도록 근거대로 좁혔다 —
    //     링크만 든 문단에는 벌어질 문장이 없다.
    // 실루엣이 **하나**인 것이 맞는 상태다. 갈래를 늘리려면 왜 같은 역할이 다른 물체인지
    // 여기에 적어라.
    ).toEqual({
      // 2026-09-03: 커뮤니티 카드의 "커뮤니티 둘러보기" 가 이 레시피로 들어왔다.
      // 실루엣이 **하나**인 것은 그대로다 — 지면(종이/잉크)만 다르고 물체는 같다.
      "font-medium min-h-11": [
        "BoundariesSection.tsx",
        "ClosingAction.tsx",
        "CommunitySection.tsx",
      ],
    });
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
        (c: string) =>
          hasUtility(c, "landing-tape")
          && (/text-\[\d+(?:\.\d+)?(?:px|rem)\]/u.test(c)
            || /(?<![\w-])font-(?:normal|medium|semibold|bold)(?![\w-])/u.test(c)),
      );
      expect(lying, `${file}: 테이프 eyebrow에 건 크기·웨이트는 .landing-tape가 이겨서 죽는다`).toEqual([]);
    }
  });

  it("keeps the closing CTA ahead of its conditions, and keeps the conditions", () => {
    // 조건 네 개를 한 덩어리로 버튼 앞에 쌓으면 실측에서 페이지의 마지막 행동이
    // 접힘선 아래 53px(1280) · 266px(390)로 밀렸다. 지우지 않고 나눈 상태를 고정한다.
    //
    // 2026-08-27 재조준: `startConditions` 배열이 없어졌다. 조건은 이제
    // `landingContent.closing.note` 한 문단이고 통째로 버튼 **뒤**에 있다. 위치
    // 문제는 그래서 더 세게 풀렸다. 이 단언이 계속 지키는 것은 두 가지다.
    //  - 마지막 행동이 조건 더미에 밀리지 않는다(순서).
    //  - 조건이 사라지지 않는다 — 접근성·고지 의무는 위치가 아니라 존재다.
    //
    // 2026-08-29: 버튼 앞 설명 문단(`closing.body`)이 없어졌다. 정본 시안의 마무리는
    // **손글씨 한 줄 + 행동 둘**이다("여기까지 읽은 사람에게 설명을 더 얹지 않는다").
    // 그래서 앞자리 검사 대상을 body 문단에서 **제목 한 줄**로 옮긴다 — 지키는 것은
    // 같다: 조건이 행동보다 앞에 쌓이지 않는다.
    const closing = sourceOf("ClosingAction.tsx");
    const titleIndex = closing.indexOf("{closing.title}");
    const ctaIndex = closing.indexOf("closing.primary.href");
    const noteIndex = closing.indexOf("{closing.note}");

    expect(titleIndex, "마무리 한 줄이 없다").toBeGreaterThan(-1);
    expect(ctaIndex, "마무리 CTA가 없다").toBeGreaterThan(-1);
    expect(noteIndex, "조건 문단이 없다").toBeGreaterThan(-1);
    expect(titleIndex).toBeLessThan(ctaIndex);
    expect(ctaIndex).toBeLessThan(noteIndex);

    // 조건이 전부 남아 있어야 한다.
    //
    // `closing` 블록을 먼저 잘라 낸 뒤 그 안의 note를 본다. 파일 전체에서 `note:`를
    // 찾으면 첫 note부터 파일 끝까지가 잡혀 **다른 섹션의 문장이 대신 답한다** —
    // 실제로 확인 섹션의 문장이 마무리 조건인 척 통과했다.
    //
    // 2026-08-28: 옛 판은 정규식으로 블록을 잘라 놓고 `not.toBe("")` 로 지켰다.
    // 경계가 사라지면 빈 문자열이 아니라 **엉뚱한 범위**가 나오므로 그 가드는
    // 울지 않는다. 못 찾으면 던지는 `contentBlock()` 으로 갈아탔다.
    //
    // 2026-08-29: **"계정 베타" 요구를 지웠다.** 2026-08-29 파운더 결정으로 베타라는
    // 틀 자체를 화면에서 쓰지 않는다(CLAUDE.md — "베타 우리 안할거야 알아둬"). 개념이
    // 없어진 자리라 옮길 곳이 없다. 다만 **없어진 것은 틀이지 고지가 아니다** — 그
    // 문장이 지고 있던 두 가지(무엇이 로그인 없이 열리나 · 지금은 결제를 요청하지
    // 않는다)는 그대로 요구한다. "베타가 화면에 아예 없다" 쪽 방향은
    // `landingSignupIsOpen.test.ts` 가 정본으로 들고 있으므로 여기서 겹쳐 세지 않는다.
    const closingBlock = contentBlock("closing", "footer");
    const note = /\bnote:\s*([\s\S]*)$/u.exec(closingBlock)?.[1] ?? "";
    expect(note, "마무리 조건 문단을 못 찾았다 — landingContent 구조가 바뀌었다").not.toBe("");
    for (const phrase of ["로그인·결제 없이 열려요", "계정이 필요해요", "결제를 요청하지 않아요"]) {
      expect(note.includes(phrase), `마무리 조건에서 "${phrase}"가 사라졌다`).toBe(true);
    }

    // 카피에 남아 있는 것과 화면이 그리는 것은 다른 질문이다. 조건 문단을 그리는
    // `<p>` 를 지우고 카피만 남겨도 위 검사는 전부 통과한다 — 그래서 렌더 쪽도 본다.
    expect(closing, "조건 문단을 그리는 <p> 가 없다").toMatch(/<p[^>]*>\{closing\.note\}<\/p>/u);
  });

  it("never puts a 44px touch target inline inside a paragraph", () => {
    // 44px 최소 높이를 문단 안 inline 요소에 주면 line box가 44px로 벌어져
    // 링크가 혼자 줄을 차지한다. WCAG 2.5.8도 문장 안 대상은 크기 요건에서 제외한다.
    // (옛 구조에는 이 자리를 위한 `inlineLink` 레시피가 있었다. 새 랜딩에서 문장 안에
    //  흐르는 링크는 `AvailableNowSection` 의 꼬리말 둘이고, 둘 다 높이를 갖지
    //  않는다 — 금지는 그대로 유효하다.)
    for (const [file, src] of surfaces) {
      const paragraphs = [...src.matchAll(/<p\b[\s\S]*?<\/p>/gu)].map((m) => m[0]);
      for (const p of paragraphs) {
        // ⚠️ 2026-08-29: 이 금지가 **문단에 링크만 든 경우까지** 잡고 있었다.
        // 그 상태로 바로 위 레시피 검사와 정면 충돌했다 — 그쪽은 "옛 레시피가
        // 요구하던 `min-h-11` 이 사라진 것"을 빚으로 적어 두고 있었다. 두 검사가
        // 서로 다른 것을 요구하면 어느 쪽을 맞춰도 다른 쪽이 깨진다.
        //
        // 금지의 **근거**로 갈랐다: "line box 가 44px 로 벌어져 링크가 혼자 줄을
        // 차지한다"는 피해는 문단에 **다른 글자가 같이 있을 때만** 생긴다. 링크만
        // 든 문단의 링크는 이미 혼자 줄을 차지하고 있어서 벌어질 문장이 없다.
        // WCAG 2.5.8 의 inline 예외도 "문장 안(in a sentence)"에만 적용되므로,
        // 그런 링크는 오히려 크기 요건을 **받는다**(22px 는 AA 최소 24px 에도 못 미쳤다).
        //
        // 링크 요소를 지우고 남은 글자로 판정한다. `{expr}` 는 지우지 않는다 —
        // 지우면 `{footLead}<Link/>{footTail}` 같은 진짜 문장이 "링크만 든 문단"으로
        // 새어 나간다.
        const textBesideLinks = p
          .replace(/<(?:Link|TrackedLandingLink|a)[\s>][\s\S]*?<\/(?:Link|TrackedLandingLink|a)>/gu, "")
          .replace(/<[^>]*>/gu, "")
          .trim();
        if (textBesideLinks === "") continue;
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
      // 2026-09-03: 어두운 띠 안의 구분선. 위 다섯은 전부 종이 위에서 보이라고 고른
      // 값이라 잉크 바탕에서는 하나도 안 보인다. 목록이 늘어난 것이 아니라 **지면이
      // 하나 늘었고** 그 지면의 구분선이 하나 생긴 것이다.
      //
      //   onInkRule  잉크 위의 목록·섹션 구분선
      "[var(--color-paper-on-ink-rule)]",
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
    // 2026-08-27 노트 개편은 종이 모서리로 `rounded-[6px]`를 11곳(6개 파일)에서
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

  it("keeps the price-source disclosure the quoted aside used to carry", () => {
    // DESIGN.md 2026-08-05: 같은 `border-l-2`가 히어로에서는 출처(커플이 한 말),
    // PreparationResult에서는 목적지(반영된 기록)를 뜻해 의미가 정반대였다.
    // 규칙선은 "인용된 출처"에만 쓰고, 반영 결과는 sage로 표시하기로 했다.
    //
    // 2026-08-27: 히어로의 blockquote와 PreparationResult가 둘 다 없어졌다. 랜딩에
    // 남은 `border-l-2`는 공시 가격 곁블록 하나뿐이었고, 그것이 곧 "인용된 출처"였다 —
    // 한국소비자원 참가격을 옮겨 왔다고 말하는 자리.
    //
    // 2026-08-29: `NotForVendorsSection` 이 삭제되면서 그 곁블록도 없어졌다.
    // **표시가 없어진 것이지 고지가 없어진 것이 아니다** — 공시 가격은 부가 기능이라
    // `availableNow.cards[2]` 카드 한 장으로 내려갔고(파운더: "메인 기능을 소개해야지"),
    // 출처·기준일·한계는 그 카드의 작은 글씨와 푸터 고지가 나눠 진다. 그래서 이
    // 단언은 **표시를 세는 것에서 고지를 지키는 것으로** 자리를 옮긴다.
    //
    // 규칙선 쪽 절반은 계속 산다: 같은 표시가 다시 두 뜻을 지지 않도록, `border-l-2`
    // 를 쓰는 자리는 인용 곁블록(`<aside>`)이어야 한다. 지금은 쓰는 곳이 0이라 이
    // 고리는 비어 있고, 되살아나면 그때 운다.
    for (const [file, src] of surfaces) {
      if (!src.includes("border-l-2")) continue;
      expect(src, `${file}: 2px 규칙선은 인용 곁블록(<aside>)에만 쓴다`).toMatch(
        /<aside[^>]*border-l-2/u,
      );
    }

    // 공시 가격 카드가 진 고지 — 출처와 기준일, 그리고 "판정하지 않는다".
    const priceCard = contentBlock("availableNow", "community");
    for (const phrase of [
      "한국소비자원", // 출처
      "2025년 11월 공시 기준", // 기준일
      "값이 적정한지는 판정하지 않고", // CLAUDE.md — 품질·적정성을 판정하지 않는다
    ]) {
      expect(priceCard.includes(phrase), `공시 가격 카드에서 "${phrase}"가 사라졌다`).toBe(true);
    }

    // 푸터가 진 나머지 — 출처 한 줄과 **지역 편차**. 곁블록이 없어졌다고 이 문장이
    // 같이 사라지면, 사용자가 "우리 지역엔 없네"를 우리 잘못으로 읽는다
    // (`LandingFooter.tsx` 머리말에 같은 이유가 적혀 있다).
    const footerBlock = contentBlock("footer");
    for (const phrase of [
      "한국소비자원 참가격 · 2025년 11월 공시 기준",
      "지역별로 수가 크게 달라요",
      "업체가 쓴 문장 그대로예요",
    ]) {
      expect(footerBlock.includes(phrase), `푸터 고지에서 "${phrase}"가 사라졌다`).toBe(true);
    }
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
      const decorations = styleLiterals(src).filter((c: string) => {
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
        (c: string) => c.includes("mx-auto") && c.includes("inline-flex"),
      );
      expect(bad, `${file}: inline-flex 요소에 mx-auto를 걸었다`).toEqual([]);
    }
  });
  it("파란 펜 밑줄은 누를 수 있는 것에만 붙는다", () => {
    // `.landing-pen` 은 globals.css 에서 `border-bottom: 2px solid …` 다. 이 랜딩에서
    // 밑줄은 **"누를 수 있다"** 는 뜻이고, 바로 위 레시피 검사도 그 조합을 "홀로 서는
    // 링크"로 못 박는다.
    //
    // ⚠️ 여기 "정본 시안도 `.pen` 을 실제 링크 두 곳에만 썼다" 고 적혀 있었다. **거꾸로다.**
    // 시안은 `.pen` 을 두 번 쓰는데 둘 다 문장 안 `<span class="pen">` 이고 링크가 아니다
    // (NotebookBest.html:1452). 구현이 그 두 자리를 진짜 링크로 만든 것이다
    // (`AvailableNowSection.tsx`). 시안이 근거가 아니라 **이 저장소의 좁힌 약속**이 근거다.
    //
    // 2026-08-29 실측: `CommunitySection` 의 카테고리 이름 다섯이 그 밑줄을 달고
    // 있었는데 링크가 아니었다. 화면에서는 링크와 구분되지 않아 눌러도 아무 일이
    // 없다 — 이 저장소가 "이 서비스는 고장났다고 읽는 실패" 라고 부르는 종류다.
    //
    // ⚠️ 여기 손글씨 예외(`landing-hand` 와 함께면 통과)가 있었고, 근거로 "히어로의 질문
    // 한 줄이 그렇다" 를 들었다. **그 자리는 존재하지 않았다** — `TransformationHero` 의
    // `landing-pen` 은 0곳이고, `landing-hand`+`landing-pen` 동시 사용은 저장소 전체에서
    // `AmoraNoteSection.tsx:36` **하나뿐**이었다. 예외가 그 한 줄을 합법화하려고 만들어졌고,
    // 그 한 줄은 정본 시안(1348행)에 밑줄이 없다. 그래서 줄과 예외를 함께 없앴다.
    // 이제 규칙에 예외가 없다 — 밑줄은 누를 수 있는 것에만.
    const offenders: string[] = [];
    for (const [file, src] of surfaces) {
      // 여는 태그를 하나씩 훑는다. 태그 이름과 클래스를 같이 봐야 판정이 된다.
      for (const [tag] of src.matchAll(/<[A-Za-z][^>]*>/gu)) {
        if (!/landing-pen/u.test(tag)) continue;
        const isInteractive = /^<(?:a|button|Link|TrackedLandingLink)\b/u.test(tag);
        if (isInteractive) continue;
        offenders.push(`${file}: ${tag.slice(0, 72)}`);
      }
    }
    expect(
      offenders,
      "누를 수 없는 것에 파란 펜 밑줄을 붙였다 — 링크와 구분이 안 된다. "
        + "강조는 굵기·색으로 하고, 밑줄은 링크에만 남겨라.",
    ).toEqual([]);

    // 밑줄이 실제로 어딘가에는 쓰이고 있어야 이 검사가 살아 있다.
    const penCount = surfaces.reduce(
      (n, [, src]) => n + [...src.matchAll(/landing-pen/gu)].length,
      0,
    );
    expect(penCount, "랜딩에서 landing-pen 이 사라졌다 — 이 검사가 헛돈다").toBeGreaterThan(0);
  });
});
