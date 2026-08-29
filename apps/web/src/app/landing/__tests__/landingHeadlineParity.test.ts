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
 * 랜딩을 다시 만들면서 섹션 여럿이 `notebook.tsx`의 `Section`을 쓴다. h2를 직접
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
 * ## 2026-08-29 재조준 — 랜딩이 정본 시안으로 다시 지어졌다
 *
 * 랜딩이 `docs/landing/NotebookBest.html` 로 다시 지어지면서 섹션 구성이 통째로
 * 바뀌었다. 옛 짝(ScenesSection·NoSideSection·OneRoomSection·PrivateLaneSection·
 * NotForVendorsSection)은 컴포넌트와 정본 키가 **함께** 지워졌고, 그 자리를
 * 아모라·확인·커뮤니티·지금 되는 것·경계·마무리가 나눠 받는다. 짝 목록과
 * `CONTENT_ORDER` 를 새 구조로 옮겼다.
 *
 * **여기서 지키는 계약은 그대로다** — "화면에 보이는 헤드라인은 정본과 같아야 하고,
 * 정본을 아무도 안 읽는 섹션이 있으면 안 된다". 없어진 섹션들이 지고 있던 필수 고지
 * (AI 고지·점수/궁합 금지·저장 안 함·업체 편 아님·가격 출처)는 **헤드라인이 아니라
 * note 문장**이라 이 파일이 지키던 것이 아니다. 그 고지들은 `amoraNote.note`,
 * `availableNow.cards[*].note`, `boundaries.items[*]`, `footer.notice` 로 옮겨 갔고
 * 다른 테스트가 본다. 이 파일에서는 **고지를 이유로 지운 단언이 하나도 없다.**
 * "베타" 를 요구하는 단언도 원래 없었다(헤드라인만 보므로).
 *
 * 이번에 실제로 고친 것 셋:
 *
 * 1. **표기법이 아니라 뜻을 재도록.** 새 섹션 둘(커뮤니티·히어로)은 제목을
 *    `{community.title.split("\n").map(…)}` 로 그린다. 옛 판정은 `^\{…\}$` 정규식
 *    하나여서 중괄호가 겹치면 "손으로 적은 문장"으로 오해하고 빈 문자열과 비교해
 *    거짓 실패했다. 이제 **JSX 표현식이 참조하는 `….title` 체인**을 뽑아 정본을
 *    그리는지 본다.
 * 2. **정본 제목을 깊이로 집는다.** `^\s*title:` 로 물으면 `availableNow.title` 을
 *    지워도 바로 아래 `cards[0].title`("견적에서 빠진 항목 찾기")이 대신 대답한다.
 *    이 저장소에서 "다른 곳에 남은 같은 문자열이 대신 답하는" 사고가 반복됐다.
 *    이제 블록 **맨 위 층**의 title 만 읽는다.
 * 3. **제목이 없는 섹션을 면제 목록으로 명시.** `AmoraNoteSection` 의 h2 는 화면에
 *    안 나가는 sr-only 랜드마크 이름이다. 면제가 조용히 넓어지지 않게, 정말로 정본에
 *    title 이 없는지와 정말로 sr-only 인지를 매번 확인한다.
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

/**
 * 태그·JSX 표현식을 걷어내고 사람이 읽는 글자만 남긴다.
 *
 * 중괄호는 **더 지울 게 없을 때까지** 지운다. 한 번만 지우면 중첩된 표현식에서
 * 안쪽(`{line}`)만 없어지고 바깥이 남아, 그 소스 조각이 "사람이 읽는 글자"로
 * 둔갑한다 — 2026-08-29에 실제로 커뮤니티·히어로 제목이 그렇게 읽혔다.
 */
function readable(raw: string): string {
  let out = raw.replace(/<[^>]*>/gu, ""); // 태그 제거
  for (;;) {
    const next = out.replace(/\{[^{}]*\}/gu, ""); // JSX 표현식 제거
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/gu, " ").trim();
}

/**
 * 소스 문자열을 화면 글자로.
 *
 * 정본의 `\n`은 소스에서 두 글자(역슬래시+n)이고, 화면에서는 `Section`이
 * `title.split("\n")`으로 줄을 나눈다. 줄바꿈은 사람이 읽을 때 공백 하나이므로
 * 공백으로 바꿔 비교한다 — 안 그러면 두 줄짜리 제목(hero·community·confirm)이
 * 거짓 실패한다.
 */
function sourceStringToText(raw: string): string {
  return raw
    .replace(/\\n/gu, " ")
    .replace(/\\"/gu, "\"")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * JSX 표현식이 참조하는 `….title` 체인 전부.
 *
 * `{closing.title}` 도, `{community.title.split("\n").map(…)}` 도 사람이 읽는 글자의
 * 출처는 하나뿐이다 — 그 출처가 정본인지만 보면 된다. 표기(중괄호 한 겹이냐 중첩된
 * map 이냐)에 묶이지 않게 **참조를 세는 쪽**으로 바꿨다. 옛 판정은 `^\{…\}$` 라
 * 중첩 중괄호를 "손으로 적은 문장"으로 오해했다.
 *
 * 태그를 먼저 지운다. 안 지우면 `<span key={line}>` 같은 프로프가 섞여 들어온다.
 */
function titleRefsIn(raw: string): string[] {
  const withoutTags = raw.replace(/<[^>]*>/gu, "");
  return [
    ...withoutTags.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.title\b/gu),
  ].map((match: RegExpMatchArray) => match[0]);
}

/**
 * 화면 헤드라인이 무엇으로 그려지는지.
 *
 * - `canonical` — 정본 상수를 그대로 그린 자리. **어느 상수인지**를 `refs` 로 확인한다.
 * - `text`      — 손으로 적은 문장. 정본과 글자까지 같아야 한다.
 * - `none`      — 헤드라인 자체가 없다. 섹션에서 제목이 사라진 것이므로 실패다.
 */
type Headline =
  | { readonly kind: "canonical"; readonly refs: readonly string[] }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "none" };

/** 표현식 소스가 통째로 문자열 리터럴이면 그 안의 글자. 아니면 undefined. */
function stringLiteral(raw: string): string | undefined {
  return raw.trim().match(/^"((?:[^"\\]|\\.)*)"$/u)?.[1];
}

function headlineOf(file: string): Headline {
  const block = headlineBlock(file);
  if (block !== "") {
    const inner = block
      .replace(/^<(h1|h2)\b[^>]*>/u, "")
      .replace(/<\/(h1|h2)>$/u, "")
      .trim();
    // 사람이 읽는 글자가 남으면 손으로 적은 것이다. 아무것도 안 남으면 전부 JSX
    // 표현식이므로, 그 표현식이 정본을 가리키는지 본다.
    const literal = readable(inner);
    if (literal !== "") return { kind: "text", value: literal };
    return { kind: "canonical", refs: titleRefsIn(inner) };
  }

  const prop = sectionTitleProp(file);
  if (prop.startsWith("{")) {
    const expression = prop.slice(1, -1).trim();
    const inlineString = stringLiteral(expression);
    if (inlineString !== undefined) {
      return { kind: "text", value: sourceStringToText(inlineString) };
    }
    return { kind: "canonical", refs: titleRefsIn(expression) };
  }
  if (prop.startsWith("\"")) {
    return { kind: "text", value: sourceStringToText(prop.slice(1, -1)) };
  }
  return { kind: "none" };
}

/**
 * `landingContent` 의 블록 순서 — `contentBlock` 의 **끝 경계**로 쓴다.
 *
 * 끝 경계를 주지 않으면 블록이 파일 끝까지 넓어져, 어떤 섹션의 title 을 지워도 다음
 * 블록의 title 이 대신 대답한다. 경계를 못 찾으면 `contentBlock` 이 던진다.
 *
 * 2026-08-29 개편으로 블록이 통째로 갈렸다(scenes·noSide·oneRoom·privateLane·
 * notForVendors 가 사라지고 amoraNote·community·boundaries 가 들어왔다).
 * **`landingContent.ts` 에 적힌 순서 그대로**여야 한다 — `contentBlock` 이 `indexOf`
 * 로 앞뒤를 자르기 때문에 순서가 어긋나면 경계를 못 찾고 던진다.
 *
 * 마지막 `headerNav` 는 카피 블록이 아니라 `footer` 의 끝 경계다(최상위 export 라
 * `contentBlock` 이 `export const … = ` 형태로도 경계를 찾는다). 이게 없으면 footer
 * 블록이 파일 끝까지 넓어진다.
 */
const CONTENT_ORDER = [
  "hero",
  "amoraNote",
  // 2026-08-29 복원 — 운영 랜딩에 있던 넷. 이 목록은 **정본 파일의 실제 순서**여야
  // 한다(다음 블록 이름으로 경계를 자르기 때문이다). 블록을 옮기면 여기도 옮겨라.
  "scenes",
  "noSide",
  "oneRoom",
  "privateLane",
  "community",
  "availableNow",
  "confirm",
  "boundaries",
  "closing",
  "footer",
  "headerNav",
] as const;

/**
 * 블록의 **맨 위 층** title 값. 없으면 undefined.
 *
 * 깊이를 안 보면 `availableNow.title` 을 지워도 그 아래 `cards[0].title`
 * ("견적에서 빠진 항목 찾기")이 대신 대답한다. 이 저장소에서 "다른 곳에 남은 같은
 * 문자열이 대신 답하는" 사고가 반복됐으므로 중괄호·대괄호 깊이를 직접 센다.
 * 문자열 리터럴 안은 통째로 넘긴다 — 카피에 `{` 가 들어와도 깊이가 흔들리지 않게.
 */
function topLevelTitle(block: string): string | undefined {
  const open = block.indexOf("{");
  if (open < 0) return undefined;

  let depth = 0;
  for (let i = open; i < block.length; i += 1) {
    const c = block[i];

    if (c === "\"" || c === "'" || c === "`") {
      i += 1;
      while (i < block.length && block[i] !== c) {
        if (block[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }

    if (c === "{" || c === "[") {
      depth += 1;
      continue;
    }
    if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (
      depth === 1
      && block.startsWith("title:", i)
      && !/[\w$.]/u.test(block[i - 1] ?? "")
    ) {
      return block.slice(i).match(/^title:\s*"((?:[^"\\]|\\.)*)"/u)?.[1];
    }
  }
  return undefined;
}

/** 정본 블록의 title. 블록 경계를 못 찾으면 `contentBlock` 이 던진다. */
function canonicalTitleOrNone(section: string): string | undefined {
  const index = CONTENT_ORDER.indexOf(section as (typeof CONTENT_ORDER)[number]);
  if (index < 0) {
    throw new Error(`"${section}" 이 CONTENT_ORDER 에 없습니다 — 블록을 추가했으면 여기도 추가해야 합니다.`);
  }
  const next: string | undefined = CONTENT_ORDER[index + 1];
  const block = next === undefined ? contentBlock(section) : contentBlock(section, next);
  return topLevelTitle(block);
}

/** landingContent 블록의 title 값을 읽는다. 없으면 던진다. */
function canonicalTitle(section: string): string {
  const title = canonicalTitleOrNone(section);
  if (title === undefined) {
    throw new Error(`landingContent.${section}.title 을 찾지 못했습니다.`);
  }
  return title;
}

/**
 * "정본을 그대로 넘긴 것"으로 인정할 표현식들.
 *
 * 컴포넌트는 `const { closing } = landingContent` 처럼 구조분해해서 쓴다. 별칭까지
 * 따라가는 이유는 한때 `const { availableNow: copy }` 처럼 이름을 바꿔 받는 섹션이
 * 있었기 때문이다(지금은 없지만, 이름을 바꿔 받는 순간 정본 참조가 하드코딩으로
 * 오해된다). 반대로 여기 없는 표현식(다른 섹션의 title, 문자열 조립)은 통과시키지
 * 않는다.
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

/**
 * 컴포넌트 ↔ 정본 블록 짝.
 *
 * 2026-08-29 정본 시안 개편으로 갈아 끼웠다. `page.tsx` 의 `<main>` 이 그리는 순서와
 * 같게 적는다 — 아래 "짝 목록에 있다" 케이스가 그 목록을 전수로 대조한다.
 */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ConfirmSection", "confirm"],
  // 2026-08-29 복원. 운영 랜딩(`hanbang.ai/landing`)에 있던 넷을 시안 개편에서
  // 잃었다가 파운더 지적으로 되살렸다 — 각각 정본 블록과 짝을 이룬다.
  ["ScenesSection", "scenes"],
  ["NoSideSection", "noSide"],
  ["OneRoomSection", "oneRoom"],
  ["PrivateLaneSection", "privateLane"],
  ["CommunitySection", "community"],
  ["AvailableNowSection", "availableNow"],
  ["BoundariesSection", "boundaries"],
  ["ClosingAction", "closing"],
];

/** h1 을 그리는 섹션 — 아래 마지막 케이스가 따로 대조한다. */
const HERO_FILE = "TransformationHero";

/**
 * 정본에 title 이 **없는** 섹션.
 *
 * `AmoraNoteSection` 은 히어로에서 이어지는 대화 카드라 화면에 제목을 쓰지 않는다.
 * 그래도 랜드마크에는 이름이 있어야 해서 h2 를 sr-only 로 둔다 — 그 h2 는 카피가
 * 아니라 접근성 이름이므로 대조할 정본이 없다.
 *
 * 면제는 조용히 넓어진다. 그래서 아래 케이스가 매번 확인한다:
 * (1) 이 면제가 아직 화면에 있는 섹션인지, (2) 정본 블록에 정말로 title 이 없는지,
 * (3) h2 가 정말로 sr-only 인지.
 */
const TITLELESS: ReadonlyArray<readonly [string, string]> = [
  ["AmoraNoteSection", "amoraNote"],
];

/** 화면 헤드라인 ↔ 정본 대조. PAIRS 와 히어로가 같은 기계를 쓴다. */
function expectHeadlineMatchesCanonical(file: string, section: string): void {
  const canonical = sourceStringToText(canonicalTitle(section));
  expect(canonical, `landingContent.${section}.title이 비어 있다`).not.toBe("");

  const headline = headlineOf(file);
  expect(
    headline.kind,
    `${file}에서 헤드라인(h1/h2 또는 <Section title=…>)을 찾지 못함`,
  ).not.toBe("none");

  // 정본 상수를 직접 렌더하면 드리프트가 생길 수 없다. 단 **어느 상수인지** 봐야 한다.
  if (headline.kind === "canonical") {
    const allowed = canonicalTitleRefs(file, section);
    expect(
      headline.refs,
      `${file}의 헤드라인이 아무 title 상수도 그리지 않는다`,
    ).not.toHaveLength(0);
    expect(
      headline.refs.filter((ref: string) => !allowed.includes(ref)),
      `${file}의 헤드라인이 정본(${allowed.join(" 또는 ")})이 아닌 것을 그린다`,
    ).toEqual([]);
    return;
  }

  // 하드코딩된 span 조합이면 사람이 읽는 결과가 정본과 같아야 한다.
  if (headline.kind === "text") {
    expect(headline.value, `${file} 헤드라인이 비어 있다`).not.toBe("");
    expect(headline.value).toBe(canonical);
  }
}

describe("landing headline parity", () => {
  it("Section이 title 프로프를 h2로 그린다 — 프로프 경로를 인정하는 근거", () => {
    // 이 전제가 무너지면 아래 `canonical` 통과는 "화면에 없는 문장"을 통과시킨다.
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
    const covered = [
      ...PAIRS.map(([file]: readonly [string, string]) => file),
      ...TITLELESS.map(([file]: readonly [string, string]) => file),
      HERO_FILE,
    ];
    for (const section of renderedSections()) {
      expect(covered, `${section}의 헤드라인을 아무도 정본과 대조하지 않는다`).toContain(section);
    }
  });

  for (const [file, section] of TITLELESS) {
    it(`${file}은 제목 없는 섹션이다 — 면제가 아직 참인지 확인`, () => {
      // (1) 화면에 없는 섹션을 면제하고 있으면 목록이 썩은 것이다.
      expect(
        renderedSections(),
        `${file}은 page.tsx가 그리지 않는다 — 면제 목록이 낡았다`,
      ).toContain(file);

      // (2) 정본에 title 이 생겼다면 그건 화면 카피이고 짝을 지어 대조해야 한다.
      expect(
        canonicalTitleOrNone(section),
        `landingContent.${section}.title 이 생겼다 — PAIRS 로 옮겨 정본과 대조해야 한다`,
      ).toBeUndefined();

      // (3) sr-only 가 벗겨지면 그 h2 는 아무도 정본과 대조하지 않는 화면 헤드라인이 된다.
      expect(
        headlineBlock(file),
        `${file}의 h2가 화면에 보이게 됐다 — 그러면 대조할 정본이 있어야 한다`,
      ).toContain("sr-only");
    });
  }

  for (const [file, section] of PAIRS) {
    it(`${file}의 화면 헤드라인이 landingContent.${section}.title과 같다`, () => {
      expectHeadlineMatchesCanonical(file, section);
    });
  }

  it("히어로 H1도 정본과 같고, hero.title은 죽은 상수가 아니다", () => {
    // 히어로만 h1 이다. 나머지와 같은 기계로 재되, h1 이라는 것 자체를 못 박는다 —
    // 페이지의 유일한 h1 이 정본을 그리지 않으면 검색·스크린리더가 보는 제목이 갈린다.
    expect(
      headlineBlock(HERO_FILE),
      "TransformationHero에서 h1을 찾지 못함",
    ).toMatch(/^<h1\b/u);
    expectHeadlineMatchesCanonical(HERO_FILE, "hero");
  });
});
