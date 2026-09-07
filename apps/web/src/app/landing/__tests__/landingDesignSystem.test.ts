// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LandingPage from "../page";
import { landingContent } from "@/components/landing/redesign/landingContent";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

function landingDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
}

/** 렌더된 클래스의 길이만 비교한다. 실제 줄바꿈·화면 높이는 브라우저 QA에서 검증한다. */
function spaceAt(element: Element, property: string, viewport: number): number {
  const breakpoints: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280 };
  let value = 0;
  let priority = -1;
  for (const token of element.classList) {
    const match = /^(?:(sm|md|lg|xl):)?(!?)(min-h|p[xytrbl]?)-(\d+(?:\.\d+)?|\[\d+(?:\.\d+)?(?:px|rem)\])(!?)$/u.exec(token);
    if (!match) continue;
    const minimum = match[1] ? breakpoints[match[1]] : 0;
    const axis = match[3];
    const rank = minimum + (match[2] || match[5] ? 10000 : 0);
    const applies = axis === property || (["pt", "pb"].includes(property) && axis === "py");
    if (!applies || minimum > viewport || rank < priority) continue;
    const raw = match[4].replace(/^\[|\]$/gu, "");
    value = raw.endsWith("px") ? parseFloat(raw)
      : raw.endsWith("rem") ? parseFloat(raw) * 16 : Number(raw) * 4;
    priority = rank;
  }
  return value;
}



import {
  APP_ROOT,
  contentBlock,
  everyLandingComponent,
  landingComponentFiles,
  rendered,
  renderedSections,
  source,
  stripComments,
} from "./landingSource";

/**
 * 2026-09-06 승인 HTML에 따른 랜딩 디자인 계약.
 * 렌더된 요소의 접근성·위계·고지와 등록된 색상·서체를 검사한다.
 * 특정 export 개수나 예전 CSS 문자열은 계약으로 삼지 않는다.
 * 실제 줄바꿈·가로 넘침·초점 이동은 브라우저 QA에서 함께 확인한다.
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

/**
 * globals.css 의 랜딩 블록. 다음 예절 가이드·아모라 블록은 별도 디자인이다.
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
  const end = globals.indexOf('.manners-roles input[type="radio"] {', start);
  if (end < 0) {
    throw new Error("globals.css 에서 랜딩 다음 예절 가이드 블록을 찾지 못했습니다. 검사 경계를 확인해 주세요.");
  }
  return globals.slice(start, end);
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

  it("keeps entry controls keyboard accessible and confirmation samples inert", () => {
    const doc = landingDocument();
    for (const id of ["hero-title", "closing-title"]) {
      const section = doc.getElementById(id)?.closest("section");
      expect(section, id).toBeTruthy();
      const primary = section?.querySelector<HTMLAnchorElement>('a[href="/login?mode=signup"]');
      expect(primary?.textContent?.trim()).toBe(landingContent.hero.primary.label);
      expect(primary?.getAttribute("tabindex")).not.toBe("-1");
      expect(primary?.getAttribute("aria-disabled")).not.toBe("true");
      expect(primary?.className).toMatch(/focus-visible:(?:ring|outline)/u);
      expect(spaceAt(primary!, "min-h", 320)).toBeGreaterThanOrEqual(44);
    }
    const confirm = doc.getElementById("confirm");
    expect(confirm).toBeTruthy();
    expect(confirm?.textContent).toContain(landingContent.confirm.sample.state);
    expect(confirm?.querySelectorAll("button,input,select,textarea")).toHaveLength(0);
    for (const label of [landingContent.confirm.sample.confirm, landingContent.confirm.sample.edit,
      landingContent.confirm.sample.later]) {
      const control = [...confirm!.querySelectorAll("span")].find((span) => span.textContent === label);
      expect(control?.closest('[aria-hidden="true"]'), label).toBeTruthy();
      expect(control?.closest("a,button,[role=button]")).toBeNull();
      expect(control?.getAttribute("tabindex")).toBeNull();
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

  it("renders the approved section spacing and fluid content width", () => {
    const doc = landingDocument();
    const sections = [...doc.querySelectorAll("main > section")].filter(
      (section) => !section.querySelector("#hero-title, #closing-title"),
    );
    expect(sections.length).toBeGreaterThan(4);
    for (const section of sections) {
      for (const edge of ["pt", "pb"]) {
        // 무료 도구·커뮤니티는 한 띠로 이어지고, 다크 띠의 중간 여백도 줄인다.
        const joinedPadding = section.id === "now" && edge === "pb" ? [0, 0]
          : section.id === "community" && edge === "pt" ? [34, 34]
          : section.id === "trust" && edge === "pb" ? [32, 52] : [44, 92];
        expect(spaceAt(section, edge, 320), section.getAttribute("aria-labelledby") ?? "")
          .toBe(joinedPadding[0]);
        expect(spaceAt(section, edge, 1440)).toBe(joinedPadding[1]);
      }
    }
    const heroShell = doc.getElementById("hero-title")?.closest("section")?.firstElementChild;
    expect(heroShell).toBeTruthy();
    expect(spaceAt(heroShell!, "px", 320)).toBe(18);
    const maxWidth = /max-w-\[(\d+)px\]/u.exec(heroShell!.className)?.[1];
    expect(Number(maxWidth) - 2 * spaceAt(heroShell!, "px", 1440)).toBe(1200);
    expect(heroShell?.classList.contains("w-full")).toBe(true);
  });

  it("loads the documented font weights locally through landing classes", () => {
    expect(designMd).toContain("Landing HTML exception (2026-09-06)");
    const faces = [...globals.matchAll(/@font-face\s*\{([^}]+)\}/gu)]
      .map((match) => match[1])
      .filter((face) => /font-family:\s*"Hanbang Landing (?:Display|Body|Hand)"/u.test(face));
    const weights = (family: string) => faces.filter((face) => face.includes('"' + family + '"'))
      .map((face) => Number(/font-weight:\s*(\d+)/u.exec(face)?.[1])).sort();
    expect(weights("Hanbang Landing Display")).toEqual([400]);
    expect(weights("Hanbang Landing Body")).toEqual([400, 500, 600, 700]);
    expect(weights("Hanbang Landing Hand")).toEqual([700]);
    for (const face of faces) {
      const path = /url\("([^"]+)"\)/u.exec(face)?.[1];
      expect(path).toMatch(/^\/fonts\//u);
      const fontUrl = new URL(path!, "https://hanbang.ai");
      const fontPath = resolve(APP_ROOT, "public" + fontUrl.pathname);
      expect(existsSync(fontPath)).toBe(true);
      // 1년 immutable 캐시에서도 재방문자가 변경된 글꼴을 받도록 내용으로 주소를 구분한다.
      expect(fontUrl.searchParams.get("v")).toBe(
        createHash("sha256").update(readFileSync(fontPath)).digest("hex").slice(0, 12),
      );
      expect(face).toContain("font-display: swap");
    }
    expect(globals).toMatch(/\.landing-root\s*\{[^}]*font-family:\s*"Hanbang Landing Body"/u);
    expect(globals).toMatch(/\.landing-display\s*\{[^}]*font-family:\s*"Hanbang Landing Display"/u);
    expect(globals).toMatch(/\.landing-root \.landing-hand\s*\{[^}]*font-family:\s*"Hanbang Landing Hand"/u);
    expect(landingDocument().querySelector(".landing-root")).toBeTruthy();
  });

  it("keeps display headings at the loaded weight and handwriting on short tape copy", () => {
    const doc = landingDocument();
    expect(globals).toMatch(/\.landing-display\s*\{[^}]*font-weight:\s*400/u);
    expect(globals).toMatch(/\.landing-hand\s*\{[^}]*font-weight:\s*700/u);
    for (const heading of doc.querySelectorAll("h1,h2")) {
      expect(heading.classList.contains("landing-display"), heading.textContent ?? "").toBe(true);
      expect(heading.className).not.toMatch(/\bfont-(?:medium|semibold|bold|black)\b/u);
    }
    const handwritten = [...doc.querySelectorAll(".landing-hand")];
    expect(handwritten).toHaveLength(1);
    expect(handwritten[0].classList.contains("landing-tape")).toBe(true);
    expect(handwritten[0].textContent?.trim()).toBe(landingContent.hero.tape);
    expect(handwritten[0].textContent?.length).toBeLessThan(60);
  });

  it("renders section labels and keeps small-copy colours readable", () => {
    const doc = landingDocument();
    const labels = Object.values(landingContent)
      .flatMap((block) => "eyebrow" in block && typeof block.eyebrow === "string"
        ? [block.eyebrow] : []);
    expect(labels.length).toBeGreaterThan(3);
    for (const label of labels) {
      const matches = [...doc.querySelectorAll("span,p")].filter(
        (element) => element.textContent?.trim() === label,
      );
      expect(matches.length, label).toBeGreaterThan(0);
      expect(matches.some((element) => !element.closest('[hidden],[aria-hidden="true"],.hidden,.sr-only')),
        label).toBe(true);
    }
    for (const [foreground, background] of [
      ["--color-paper-tape-ink", "--color-paper-tape"],
      ["--color-paper-ink-faint", "--color-paper-sheet"],
      ["--color-rose-700", "--color-ivory-warm"],
      ["--color-paper-on-ink-faint", "--color-paper-ink"],
    ]) {
      expect(contrast(hexOf(foreground), hexOf(background)), foreground).toBeGreaterThanOrEqual(4.5);
    }
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

  it("keeps sentence links inline without enlarging the paragraph line box", () => {
    const doc = landingDocument();
    let sentenceLinks = 0;
    for (const paragraph of doc.querySelectorAll("p")) {
      const links = [...paragraph.querySelectorAll("a")];
      if (links.length === 0) continue;
      const withoutLinks = paragraph.cloneNode(true) as Element;
      withoutLinks.querySelectorAll("a").forEach((link) => link.remove());
      if (!withoutLinks.textContent?.trim()) continue;
      for (const link of links) {
        sentenceLinks += 1;
        expect(spaceAt(link, "min-h", 320), link.textContent ?? "").toBeLessThan(44);
        expect(link.className).toMatch(/focus-visible:(?:ring|outline)/u);
      }
    }
    expect(sentenceLinks).toBeGreaterThan(0);
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

  it("keeps radii within the product scale or the documented landing exception", () => {
    const exception = /radii \(([^)]+)\)/u.exec(designMd)?.[1];
    expect(exception).toBeTruthy();
    const [radii, tails] = (exception ?? "").split(";");
    const approved = [...radii.matchAll(/\d+(?:\.\d+)?/gu)]
      .map((match) => Number(match[0]));
    const bubbleTails = new Set([...(tails ?? "").matchAll(/\d+(?:\.\d+)?/gu)]
      .map((match) => Number(match[0])));
    const allowed = new Set([6, 8, 12, 16, 20, 28, ...approved]);
    for (const [file, src] of surfaces) {
      const off = [...src.matchAll(/rounded(?:-[a-z]{1,2})?-\[(\d+(?:\.\d+)?)(px|rem)\]/gu)]
        .filter((m) => {
          const size = m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
          return !allowed.has(size) && !(bubbleTails.has(size) && /^rounded-b[rl]-/u.test(m[0]));
        })
        .map((m) => m[0]);
      expect(off, file).toEqual([]);
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
