// @vitest-environment node

import { describe, expect, it } from "vitest";

import { contentBlock, rendered, renderedSections } from "./landingSource";

/**
 * 헤드라인 카피 이중 사본 방지.
 *
 * `landingContent.ts`는 카피 정본이지만, 컴포넌트는 줄바꿈·색 강조를 위해 헤드라인을
 * 여러 `<span>`으로 쪼개 하드코딩한다. 두 사본이 갈리면 정본만 읽고 인계받는 사람이
 * 화면에 없는 문장을 현재 카피로 오인한다. 실제로 `continuity.title`은
 * "…기준으로 이어져요."인데 화면은 "…기준으로."로 이미 어긋나 있었다(그 섹션은
 * 2026-08-27 개편에서 지워졌지만 사고 유형은 그대로 남아 있다).
 *
 * ## 2026-08-27 재조준 — 헤드라인이 h2에서 `<Section title={…}>`로 옮겨졌다
 *
 * 랜딩을 다시 만들면서 섹션 여덟 개가 `notebook.tsx`의 `Section`을 쓴다. h2를 직접
 * 쓰지 않고 title 프로프로 넘기므로, 컴포넌트 소스에서 h1/h2만 찾으면 "헤드라인이
 * 없다"로 읽혀 전부 실패했다. 그래서 **찾는 자리**를 h1/h2 **또는**
 * `<Section … title={…}>`로 넓혔다. 검사 자체는 그대로다 — 정본 상수를 그대로
 * 넘겼으면 드리프트가 생길 수 없으니 통과, 문장을 손으로 적었으면 사람이 읽는 결과가
 * 정본과 글자까지 같아야 한다.
 *
 * 프로프 경로를 인정하는 근거는 "Section이 title을 h2에 넣는다" 하나뿐이다. 그 전제가
 * 무너지면 이 escape hatch가 빈 통과가 되므로 아래 첫 케이스에서 따로 못 박는다.
 *
 * ## 2026-08-28 재조준 — 주석이 헤드라인 대신 대답했다
 *
 * 추출기 둘(`headlineBlock`, `sectionTitleProp`)이 **원문**을 읽었다. 그래서 적대적
 * 검증에서 이런 변형이 그냥 통과했다:
 *
 *   /␣* <h2>{scenes.title}</h2> *␣/          ← 주석 한 줄
 *   <Section title="아무렇게나 바꾼 문장">   ← 진짜 화면
 *
 * `headlineBlock` 의 정규식이 **먼저 나오는** 주석 쪽 h2 를 물어 "정본을 그대로 그린다"로
 * 읽었다. 이제 셋 다 `rendered(...)` — 주석을 벗긴 소스 — 를 읽는다. 사본을 만들지 마라.
 *
 * 정본 제목을 읽는 쪽도 같이 고쳤다. 예전에는 `^  key: \{([\s\S]*?)^  \},` 정규식이
 * 못 찾으면 조용히 `""`를 돌려줬고, `contentBlock(...)`은 경계를 못 찾으면 **던진다**.
 *
 * 짝 목록도 새 섹션으로 갈았다. 옛 짝(ProblemMirrorSection·PreparationResult·
 * ContinuitySection·SharedPrivateSection·TrustEvidenceSection)은 컴포넌트와 정본 키가
 * 함께 지워졌고, 그 자리를 아래 여덟 섹션이 나눠 받는다. 목록을 손으로 들고 있으므로,
 * `page.tsx`가 그리는 섹션이 전부 이 목록에 있는지도 함께 본다 — 새 섹션이 짝 없이
 * 들어오면 그 헤드라인은 아무도 정본과 대조하지 않는다.
 */

const DIR = "src/components/landing/redesign";

/** 주석을 벗긴 컴포넌트 소스. 화면에 나가는 것만 본다. */
function componentSource(file: string): string {
  return rendered(`${DIR}/${file}.tsx`);
}

/** 컴포넌트가 실제로 그리는 첫 h1 또는 h2 블록. */
function headlineBlock(file: string): string {
  return componentSource(file).match(/<(h1|h2)\b[\s\S]*?<\/\1>/u)?.[0] ?? "";
}

/** `<Section …>` 여는 태그에 붙은 title 원문. `{표현식}`이든 `"문장"`이든 붙은 그대로. */
function sectionTitleProp(file: string): string {
  const openingTag = componentSource(file).match(/<Section\b[^>]*>/u)?.[0] ?? "";
  return openingTag.match(/\btitle=(\{[^{}]*\}|"[^"]*")/u)?.[1] ?? "";
}

/** 태그·JSX 표현식을 걷어내고 사람이 읽는 글자만 남긴다. */
function readable(raw: string): string {
  return raw
    .replace(/<[^>]*>/gu, "")       // 태그 제거
    .replace(/\{[^{}]*\}/gu, "")    // JSX 표현식 제거
    .replace(/\s+/gu, " ")
    .trim();
}

/** 블록에서 사람이 읽는 텍스트만 뽑는다(하드코딩된 span 조합용). */
function renderedHeadline(file: string): string {
  return readable(headlineBlock(file));
}

/**
 * 소스 문자열을 화면 글자로.
 *
 * 정본의 `\n`은 소스에서 두 글자(역슬래시+n)이고, 화면에서는 `Section`이
 * `title.split("\n")`으로 줄을 나눈다. 줄바꿈은 사람이 읽을 때 공백 하나이므로
 * 공백으로 바꿔 비교한다 — 안 그러면 두 줄짜리 제목(hero·confirm)이 거짓 실패한다.
 */
function sourceStringToText(raw: string): string {
  return raw
    .replace(/\\n/gu, " ")
    .replace(/\\"/gu, "\"")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * 화면 헤드라인이 무엇으로 그려지는지.
 *
 * - `expression` — `{closing.title}`처럼 상수를 그대로 넘긴 자리. 드리프트가 불가능하다.
 * - `text`       — 손으로 적은 문장. 정본과 글자까지 같아야 한다.
 * - `none`       — 헤드라인 자체가 없다. 섹션에서 제목이 사라진 것이므로 실패다.
 */
type Headline =
  | { readonly kind: "expression"; readonly value: string }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "none"; readonly value: "" };

function headlineOf(file: string): Headline {
  const block = headlineBlock(file);
  if (block !== "") {
    const inner = block
      .replace(/^<(h1|h2)\b[^>]*>/u, "")
      .replace(/<\/(h1|h2)>$/u, "")
      .trim();
    const onlyExpression = inner.match(/^\{([^{}]*)\}$/u)?.[1];
    if (onlyExpression !== undefined) {
      return { kind: "expression", value: onlyExpression.trim() };
    }
    return { kind: "text", value: readable(inner) };
  }

  const prop = sectionTitleProp(file);
  if (prop.startsWith("{")) {
    return { kind: "expression", value: prop.slice(1, -1).trim() };
  }
  if (prop.startsWith("\"")) {
    return { kind: "text", value: sourceStringToText(prop.slice(1, -1)) };
  }
  return { kind: "none", value: "" };
}

/**
 * `landingContent` 의 블록 순서 — `contentBlock` 의 **끝 경계**로 쓴다.
 *
 * 끝 경계를 주지 않으면 블록이 파일 끝까지 넓어져, 어떤 섹션의 title 을 지워도 다음
 * 블록의 title 이 대신 대답한다. 경계를 못 찾으면 `contentBlock` 이 던진다.
 */
const CONTENT_ORDER = [
  "hero",
  "scenes",
  "noSide",
  "oneRoom",
  "privateLane",
  "confirm",
  "notForVendors",
  "availableNow",
  "closing",
  "footer",
] as const;

/** landingContent의 `key: { ... title: "..." }` 값을 읽는다. 없으면 던진다. */
function canonicalTitle(section: string): string {
  const index = CONTENT_ORDER.indexOf(section as (typeof CONTENT_ORDER)[number]);
  if (index < 0) {
    throw new Error(`"${section}" 이 CONTENT_ORDER 에 없습니다 — 블록을 추가했으면 여기도 추가해야 합니다.`);
  }
  const next: string | undefined = CONTENT_ORDER[index + 1];
  const block = next === undefined ? contentBlock(section) : contentBlock(section, next);
  const title = block.match(/^\s*title:\s*"([^"]*)"/mu)?.[1];
  if (title === undefined) {
    throw new Error(`landingContent.${section}.title 을 찾지 못했습니다.`);
  }
  return title;
}

/**
 * "정본을 그대로 넘긴 것"으로 인정할 표현식들.
 *
 * 컴포넌트는 `const { scenes } = landingContent` 처럼 구조분해해서 쓰고,
 * AvailableNowSection은 `const { availableNow: copy }`로 이름까지 바꾼다. 별칭을
 * 따라가지 않으면 정본을 그대로 넘긴 자리를 하드코딩으로 오해한다. 반대로 여기 없는
 * 표현식(다른 섹션의 title, 문자열 조립)은 통과시키지 않는다.
 */
function canonicalTitleRefs(file: string, section: string): readonly string[] {
  const alias = componentSource(file).match(
    new RegExp(
      `const\\s*\\{[^}]*\\b${section}\\b\\s*(?::\\s*([A-Za-z_$][\\w$]*))?[^}]*\\}\\s*=\\s*landingContent`,
      "u",
    ),
  );
  const refs = [`landingContent.${section}.title`];
  if (alias) refs.push(`${alias[1] ?? section}.title`);
  return refs;
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ScenesSection", "scenes"],
  ["NoSideSection", "noSide"],
  ["OneRoomSection", "oneRoom"],
  ["PrivateLaneSection", "privateLane"],
  ["ConfirmSection", "confirm"],
  ["NotForVendorsSection", "notForVendors"],
  ["AvailableNowSection", "availableNow"],
  ["ClosingAction", "closing"],
];

/** h1 을 손으로 적는 섹션 — 아래 마지막 케이스가 따로 대조한다. */
const HERO_FILE = "TransformationHero";

describe("landing headline parity", () => {
  it("Section이 title 프로프를 h2로 그린다 — 프로프 경로를 인정하는 근거", () => {
    // 이 전제가 무너지면 아래 `expression` 통과는 "화면에 없는 문장"을 통과시킨다.
    // 주석을 벗긴 소스에서 본다 — 원문에서 보면 h2 를 지우고 주석에 남겨도 통과한다.
    const notebook = componentSource("notebook");
    const h2 = notebook.match(/<h2\b[\s\S]*?<\/h2>/u)?.[0] ?? "";
    expect(h2, "notebook.tsx에서 h2를 찾지 못함").not.toBe("");
    expect(h2, "Section의 title이 h2로 나가지 않으면 title 프로프 검사는 빈 통과다")
      .toContain("title.split");
  });

  it("page.tsx가 그리는 섹션이 전부 짝 목록에 있다", () => {
    // 짝 목록은 손으로 들고 있다. 새 섹션이 목록 없이 들어오면 그 헤드라인은 아무도
    // 정본과 대조하지 않는다 — 손으로 적은 목록이 새 파일을 놓친 전례가 있다.
    const paired = PAIRS.map(([file]) => file);
    for (const section of renderedSections()) {
      if (section === HERO_FILE) continue;
      expect(paired, `${section}의 헤드라인을 아무도 정본과 대조하지 않는다`).toContain(section);
    }
  });

  for (const [file, section] of PAIRS) {
    it(`${file}의 화면 헤드라인이 landingContent.${section}.title과 같다`, () => {
      const canonical = sourceStringToText(canonicalTitle(section));
      expect(canonical, `landingContent.${section}.title이 비어 있다`).not.toBe("");

      const headline = headlineOf(file);
      expect(
        headline.kind,
        `${file}에서 헤드라인(h1/h2 또는 <Section title=…>)을 찾지 못함`,
      ).not.toBe("none");

      // 정본 상수를 직접 렌더하면 드리프트가 생길 수 없다.
      if (headline.kind === "expression") {
        expect(
          canonicalTitleRefs(file, section),
          `${file}의 헤드라인이 정본이 아니라 ${headline.value}를 그린다`,
        ).toContain(headline.value);
        return;
      }

      // 하드코딩된 span 조합이면 사람이 읽는 결과가 정본과 같아야 한다.
      expect(headline.value, `${file} 헤드라인이 비어 있다`).not.toBe("");
      expect(headline.value).toBe(canonical);
    });
  }

  it("히어로 H1도 정본과 같고, hero.title은 죽은 상수가 아니다", () => {
    const renderedH1 = renderedHeadline(HERO_FILE);
    expect(renderedH1, "TransformationHero에서 h1을 찾지 못함").not.toBe("");
    expect(renderedH1).toBe(sourceStringToText(canonicalTitle("hero")));
  });
});
