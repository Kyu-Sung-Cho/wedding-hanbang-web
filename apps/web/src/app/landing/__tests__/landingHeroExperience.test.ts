// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  APP_ROOT,
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
  renderedSections,
  source,
  stripComments,
} from "./landingSource";

/**
 * 랜딩 히어로·제품 경험 계약.
 *
 * ## 2026-08-27 적대적 검증에서 이 파일로 빠져나간 변형들
 *
 * 이 파일은 예전에 자기만의 `withoutComments`(줄 **처음**의 `//` 만 지움)와
 * 자기만의 `contentBlock`(경계를 못 찾아도 조용히 통과)을 갖고 있었다. 그래서
 * 아래 변형들이 전부 초록불이었다:
 *
 *  1. 줄 끝 주석·JSX 주석으로 컴포넌트를 꺼도 문구가 "있다"고 통과
 *  2. 히어로 문장을 `footer.tagline` 으로 옮겨도 파일 전체 `toContain` 이 통과
 *  3. 계약 문장 뒤에 그것을 뒤집는 문장을 붙여도 통과
 *     (가장 위험했던 실례: 확인 계약 뒤 "급할 때는 확인을 건너뛰고 바로 반영")
 *  4. `max-sm:hidden` · `className="hidden lg:block"`(맨 앞) 로 감춰도 통과
 *  5. 카피는 두고 그리는 `<p>` 만 지워도 통과
 *  6. `slice(indexOf(a), indexOf(b))` 뒤 `length > 0` — 경계가 사라져도 영원히 참
 *
 * 공용 도구(`landingSource.ts`)로 1·2·6 을 없앴고, 아래 헬퍼들이 3·4·5 를 막는다.
 * **자기 복사본을 다시 만들지 마라.**
 */

function redesign(fileName: string): string {
  return rendered(`src/components/landing/redesign/${fileName}`);
}

const hero = redesign("TransformationHero.tsx");
/**
 * 타입 스케일 정본이 옮겨졌다.
 *
 * 2026-08-27 개편 전에는 `landingType.ts`의 displayHero/displaySection/displayMuted가
 * 랜딩 헤드라인 곡선을 들고 있었다. 새 랜딩은 아무도 그 파일을 import 하지 않고
 * (`grep landingType src` → 테스트만 남았다), 공용 곡선은 `notebook.tsx`의
 * sectionTitle·bodyText·noteText가, H1 곡선은 히어로 자신이 들고 있다.
 * 그래서 이 파일이 읽는 곳을 landingType.ts → notebook.tsx로 옮겼다.
 */
const notebook = redesign("notebook.tsx");
const content = rendered(CONTENT_PATH);

/**
 * 랜딩 컴포넌트 전부. 목록을 손으로 적지 않는다 — 폴더를 읽는다.
 *
 * 손으로 적은 목록은 새로 생긴 파일을 놓친다. 계측 가드가 실제로 그랬다
 * (TrackedLandingLink·LandingHeader·섹션 8개만 봤고 푸터·모바일 메뉴는 안 봤다).
 */
const everyComponent = everyLandingComponent();

/**
 * `page.tsx` 가 **실제로 렌더하는** 섹션. 주석으로 꺼 놓은 섹션은 여기 안 잡힌다.
 *
 * 이 목록에서 파일을 유도하므로, 섹션을 추가하면 검사 대상도 저절로 늘어난다.
 */
const renderedSectionNames = renderedSections();

function sectionIndex(name: string): number {
  const index = renderedSectionNames.indexOf(name);
  expect(index, `${name} 이 <main> 에서 렌더되지 않는다`).toBeGreaterThanOrEqual(0);
  return index;
}

function componentSource(fileName: string): string {
  const found = everyComponent.find(([name]) => name === fileName);
  expect(found, `랜딩 컴포넌트를 찾지 못함: ${fileName}`).toBeTruthy();
  return found?.[1] ?? "";
}

/** 히어로를 뺀, 페이지가 렌더하는 섹션들. 히어로만 자기 H1 곡선을 갖는다. */
const sectionSources: ReadonlyArray<readonly [string, string]> = renderedSectionNames
  .filter((name) => name !== "TransformationHero")
  .map((name) => [`${name}.tsx`, componentSource(`${name}.tsx`)] as const);

/** 히어로까지 포함해 모션·전이 규칙을 함께 지켜야 하는 것들. */
const motionSources: ReadonlyArray<readonly [string, string]> = [
  ...sectionSources,
  ["TransformationHero.tsx", hero] as const,
  ["notebook.tsx", notebook] as const,
];

const scenes = componentSource("ScenesSection.tsx");
const oneRoom = componentSource("OneRoomSection.tsx");
const confirmSection = componentSource("ConfirmSection.tsx");

/**
 * 화면에서 무엇을 **감추는** 유틸리티 전부.
 *
 * 옛 정규식은 두 갈래로 뚫렸다:
 *
 *  - `(?:[a-z]+:)?hidden` 은 하이픈이 든 변형(`max-sm:hidden`)과 대괄호 변형
 *    (`min-[360px]:hidden`)을 못 잡았다.
 *  - `(?:^|\s)hidden(?:\s|$)` 은 `^` 가 문자열 시작이라 className **맨 앞**에 온
 *    `hidden`(`className="hidden lg:block"`)을 못 잡았다. OneRoomSection 의
 *    두 사람 장면 카드를 그 형태로 모바일에서 감춰도 초록불이었다.
 *
 * `overflow-hidden` 처럼 hidden 이 낱말의 일부인 것은 잡지 않는다 — 변형 접두사는
 * 반드시 `:` 로 끝나야 한다.
 *
 * `sr-only`·`invisible`·`opacity-0` 도 같이 본다. display 만 막으면 "안 보이게"는
 * 얼마든지 다른 이름으로 돌아온다.
 */
const HIDING_UTILITY =
  /(?:^|\s)(?:[\w[\]@&().#%/*+~:-]+:)?(?:hidden|invisible|sr-only|opacity-0)(?=\s|$)/u;

/** 읽을 수 없는 크기. 10px 이하는 신뢰 문구가 앉을 자리가 아니다. */
const UNREADABLE_TEXT = /text-\[(?:\d|10)px\]/u;

/** notebook.tsx가 export하는 클래스 토큰. `${noteText}` 같은 참조를 실제 값으로 편다. */
const notebookTokens: ReadonlyMap<string, string> = new Map(
  [...notebook.matchAll(/export const (\w+)\s*=\s*"([^"]*)"/gu)].map((m) => [m[1], m[2]]),
);

function expandTokens(className: string): string {
  return className.replace(/\$\{(\w+)\}/gu, (_match, name: string) => notebookTokens.get(name) ?? "");
}

/**
 * 한 파일 안의 **모든 className 값**. 문자열 형태와 템플릿 리터럴 형태를 다 본다.
 *
 * 옛 검사는 `className="…"` 만 봐서 `className={\`hidden lg:block\`}` 이 그냥
 * 빠져나갔다. 파일 안의 지역 클래스 상수(`const focusRing = "…"`)와 notebook 의
 * export 토큰도 className 값이므로 함께 센다.
 */
function classValues(text: string): string[] {
  const values: string[] = [];
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/gu)) {
    values.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  for (const m of text.matchAll(/^(?:export )?const \w+\s*=\s*\n?\s*"([^"]*)"/gmu)) {
    values.push(m[1]);
  }
  return values.map(expandTokens);
}

type OpenTag = { readonly name: string; readonly attrs: string };

/**
 * marker 를 그리는 요소와 **그 조상 전부**를 안쪽부터 바깥쪽 순서로.
 *
 * 왜 조상까지 보나: 옛 `classNameRendering` 은 문구를 그리는 바로 그 요소의
 * className 만 봤다. 그래서 `<div className="hidden sm:block">` 로 감싸면 신뢰
 * 문구를 모바일에서 통째로 감춰도 통과했다(2026-08-27 변형).
 *
 * 왜 창(window)이 아니라 스택인가: 창을 넓게 잡으면 **형제** 장식이 대신 답한다.
 * NoSideSection 의 꽃(`hidden xl:block`)이 실제로 그 창 안에 들어온다. 조상 스택은
 * 형제를 절대 포함하지 않는다.
 *
 * 속성 안의 `{ … }` 와 문자열을 건너뛰며 `>` 를 찾는다. 안 그러면
 * `onClick={() => …}` 의 `>` 를 태그 끝으로 오독한다.
 */
function renderChain(text: string, marker: string): OpenTag[] {
  const at = text.indexOf(marker);
  expect(at, `문구를 렌더하는 자리를 찾지 못함: ${marker}`).toBeGreaterThanOrEqual(0);

  const stack: OpenTag[] = [];
  let i = 0;
  while (i < at) {
    if (text[i] !== "<") {
      i += 1;
      continue;
    }
    const head = /^<(\/?)([A-Za-z][\w.]*)/u.exec(text.slice(i, i + 80));
    if (!head) {
      i += 1;
      continue;
    }

    let j = i + head[0].length;
    let depth = 0;
    let quote = "";
    let end = -1;
    while (j < text.length) {
      const c = text[j];
      if (quote) {
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
      } else if (c === ">" && depth === 0) {
        end = j;
        break;
      }
      j += 1;
    }
    if (end < 0) break;

    const tag: OpenTag = { name: head[2], attrs: text.slice(i + head[0].length, end) };

    // marker 가 이 태그의 **속성 안**에 있다(`href={hero.primary.href}`).
    // 그 태그가 곧 문구를 그리는 요소다.
    if (end >= at) {
      if (!head[1]) stack.push(tag);
      break;
    }

    if (head[1]) {
      const closedAt = stack.map((t) => t.name).lastIndexOf(tag.name);
      if (closedAt >= 0) stack.length = closedAt;
    } else if (text[end - 1] !== "/") {
      stack.push(tag);
    }
    i = end + 1;
  }

  return [...stack].reverse();
}

/** 한 여는 태그의 className 값(토큰을 편 것). */
function classNameOf(tag: OpenTag): string {
  const m = tag.attrs.match(/className=(?:\{`([^`]*)`\}|"([^"]*)"|\{"([^"]*)"\})/u);
  return expandTokens(m?.[1] ?? m?.[2] ?? m?.[3] ?? "");
}

/** marker 를 그리는 요소부터 조상까지, 하나라도 감추면 잡는다. */
function expectVisible(file: string, text: string, marker: string): void {
  const chain = renderChain(text, marker);
  expect(chain.length, `${file}: ${marker} 의 렌더 자리를 읽지 못했다`).toBeGreaterThan(0);
  for (const tag of chain) {
    const className = classNameOf(tag);
    expect(
      className,
      `${file}: <${tag.name}> 가 ${marker} 를 감춘다 — 조상 래퍼로 감추는 것도 감추는 것이다`,
    ).not.toMatch(HIDING_UTILITY);
  }
}

function windowAround(text: string, marker: string, before = 500, after = 260): string {
  const at = text.indexOf(marker);
  expect(at, `소스에서 계약 표식을 찾지 못함: ${marker}`).toBeGreaterThanOrEqual(0);
  return text.slice(Math.max(0, at - before), at + marker.length + after);
}

/**
 * `landingContent` 최상위 블록 이름을 파일 순서대로.
 *
 * 손으로 적지 않는다. 블록이 늘면 아래 "고지 문구가 화면에 닿는가" 검사도 같이 는다.
 */
const contentKeys = [...content.matchAll(/^ {2}(\w+): \{$/gmu)].map((m) => m[1]);

/** 블록 하나. 마지막 블록은 `} as const` 에서 끊어 아래 export 배열들을 물지 않는다. */
function block(key: string): string {
  const index = contentKeys.indexOf(key);
  expect(index, `landingContent 에 ${key} 블록이 없다`).toBeGreaterThanOrEqual(0);
  const next = contentKeys[index + 1];
  if (next) return contentBlock(key, next);
  return contentBlock(key).split("\n} as const")[0];
}

/**
 * 로그인 없이 열리는 것들의 카탈로그(`export const notDoing` ~ `footerLinks` 사이).
 *
 * `contentBlock("availableNow")` 는 같은 이름의 **블록**을 먼저 집으므로 export 배열을
 * 이 범위로 가져온다.
 */
const availableNowCatalogue = contentBlock("notDoing", "footerLinks");

/** clamp(...) 곡선의 최대값(rem)을 숫자로. */
function clampMaxRem(label: string, curve: string | undefined): number {
  expect(curve, `${label} 곡선을 찾지 못함`).toBeTruthy();
  const max = (curve ?? "").split(",").at(-1)?.trim() ?? "";
  const parsed = Number.parseFloat(max.replace("rem", ""));
  expect(Number.isFinite(parsed), `${label} 최대값 파싱 실패: ${max}`).toBe(true);
  return parsed;
}

describe("landing hero product experience contract", () => {
  it("explains the product in plain language before asking for action", () => {
    const heroCopy = block("hero");
    const confirmCopy = block("confirm");

    // 무엇을 하는 서비스인지 한 문장으로 말한다. 이전 판은 "웨딩한방 · 둘이 함께
    // 관리하는 결혼 준비 공간"이라는 라벨이 그 일을 했는데, 2026-08-27 개편에서
    // 라벨이 사라지고 히어로 본문 첫 문장이 그 자리를 이어받았다.
    //
    // **블록 안에서** 찾는다. 파일 전체 toContain 이던 시절에는 이 문장을
    // `footer.tagline` 으로 옮겨도 통과했다 — 첫 화면이 제품을 설명하지 않는데도.
    expect(heroCopy).toContain("웨딩한방은 둘이 어디서 갈리는지부터 봅니다");

    // 산출물을 **개수가 아니라 이름으로** 말한다. 이전 문구는 "세 가지"라고만 해서
    // 그 셋이 무엇인지 랜딩 어디에도 없었다.
    expect(heroCopy).toContain("스무 장면에 각자 답하면");
    expect(heroCopy).toContain("고른 문장 그대로 나란히 보여드려요");
    // 어형·표기를 넓힌다. "세 가지"만 막던 시절에는 "3가지"로 바꾸면 통과했다.
    expect(heroCopy, "첫 화면이 산출물을 개수로만 말하면 안 된다").not.toMatch(
      /(?:세|3|셋)\s*가지/u,
    );
    expect(content, "산출물을 개수로만 말하면 안 된다").not.toMatch(
      /지금 볼\s*(?:세|3|셋)\s*가지/u,
    );

    // 아모라를 소개할 때는 AI라는 말과 함께 소개한다. 이전 판의 라벨
    // ("아모라 · 대화를 정리하는 AI")이 지키던 것이고, 지금은 ② 편을 들지 않는다
    // 섹션의 고지문이 같은 일을 한다. **그 섹션 블록에서** 찾는다.
    expect(block("noSide")).toContain("아모라 답변은 AI가 만든 내용이에요");

    // 도구 이름은 사라지지 않았다 — 첫 화면에서 ⑤ 확인 섹션으로 **내려갔다**.
    // 옛 히어로는 예산·할 일·일정·변경 제안·준비에 반영을 첫 화면에 늘어놨는데,
    // 새 히어로는 장면 낱말로 간다(85개 시안 계량: 장면 낱말 대 도구 낱말 0.47).
    // 그래서 "제품이 무엇을 남기는지 도구 이름으로 말한다"는 계약을 여기서 지킨다.
    for (const tool of ["예산", "할 일", "일정", "제안", "반영"]) {
      expect(confirmCopy, `⑤ 확인 섹션이 ${tool}을 말하지 않는다`).toContain(tool);
    }
    expect(heroCopy, "첫 화면에 도구 이름을 늘어놓지 않는다").not.toMatch(/예산|할 일|체크리스트/u);
    expect(hero, "첫 화면에 도구 이름을 늘어놓지 않는다").not.toMatch(/예산|할 일|체크리스트/u);

    // 행동을 부르는 문장은 설명 뒤에 오고, 첫 화면과 마무리가 **같은 행동**을 부른다.
    // 다른 걸 부르면 페이지 전체가 무엇을 시키려는 건지 흐려진다.
    const primaryCta = 'primary: { label: "스무 장면 답해보기", href: "/wedding-code" }';
    expect(heroCopy).toContain(primaryCta);
    expect(block("closing")).toContain(primaryCta);

    // 감정 문구를 헤드라인 앞에 세우지 않는다. `hero.emotionalLine`은 옛 필드이고
    // 2026-08-27 개편에서 사라졌다 — 되살아나면 여기서 잡는다.
    expect(content).not.toContain("emotionalLine");
  });

  it("keeps the no-login first-step action visible from the smallest breakpoint", () => {
    const heroCopy = block("hero");

    // 로그인 없이 밟을 수 있는 첫 걸음. 옛 랜딩은 히어로 안의 날짜 폼(/start-here)이
    // 그 자리였고, 지금은 스무 장면(/wedding-code)이다. 둘 다 supabase 0 · fetch 0
    // 이라 로그인 없이 끝까지 만져진다는 점이 같다.
    expect(heroCopy).toContain('href: "/wedding-code"');
    expect(hero).toContain("hero.primary.href");

    // 가입이 필요 없다는 것과 내 답이 어디 있는지를 CTA 옆에서 말한다.
    // (옛 폼의 "없어도 시작 가능" · "첫 날짜 계산은 이 브라우저에서 처리"가 지키던 것)
    expect(heroCopy).toContain("가입도 로그인도 필요 없어요");
    expect(heroCopy).toContain("답은 이 브라우저에만 있고 저장하지 않아요");

    // **뒤에 붙여 뒤집는 것**도 막는다. 계약 문장을 그대로 두고 그 뒤에
    // "다만 결과를 보려면 가입해야 해요"를 붙이면 있어야 할 문장 검사는 전부
    // 통과하면서 계약만 죽는다(2026-08-27 변형 갈래 ③).
    expect(heroCopy, "가입 없이 된다고 해 놓고 뒤에서 가입을 요구하지 않는다").not.toMatch(
      /(?:가입|로그인|계정)[^"]{0,12}(?:해야|하셔야|필요해요|필요합니다)/u,
    );

    // 날짜 도구는 히어로에서 ⑦ 카드로 옮겨 갔다. 브라우저 안에서 계산한다는
    // 고지도 같이 따라가야 한다 — 도구만 옮기고 고지를 두고 오면 안 된다.
    // "로그인 없이 열리는 것" 카탈로그 안에 있어야 한다.
    expect(availableNowCatalogue).toContain(
      "날짜는 이 브라우저에서 계산에만 쓰고 서버로 보내지 않아요",
    );

    // AI 처리·저장 고지도 사라지지 않는다. 옛 히어로 폼 아래 있던 문장이고
    // 지금은 ④ 나만 보는 자리가 진다(`publicClaims.test.ts` 필수 문구이기도 하다).
    expect(block("privateLane")).toContain("대화 내용은 서비스에서 처리·저장될 수 있어요");

    // CTA는 어느 폭에서도 숨지 않는다 — 자기 className 도, 감싼 래퍼도.
    expectVisible("TransformationHero.tsx", hero, "hero.primary.href");
    // CTA 아래 안내도 마찬가지고, CTA와 떨어지면 안 된다.
    expectVisible("TransformationHero.tsx", hero, "hero.note");
    expect(
      windowAround(hero, "hero.primary.href", 200, 1400),
      "CTA 아래 안내가 CTA와 떨어지면 안 된다",
    ).toContain("hero.note");
  });

  it("shows one concrete proposal and marks it unapplied without a live AI call", () => {
    const confirmCopy = block("confirm");

    // 제안은 한 번에 하나다. 옛 히어로 데모의 "각각 별도 제안과 확인이 필요해요"가
    // 지키던 것을 지금은 ⑤ 확인 섹션 본문이 진다 — `publicClaims.test.ts:104-110`이
    // 문자열로 대조하는 필수 문구이기도 하다.
    expect(confirmCopy).toContain("한 번에 한 가지 변경을 제안하고");
    expect(confirmCopy).toContain("확인한 변경만 준비 기록에 반영해요");
    expect(confirmCopy).toContain("확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요");
    expect(content, "여러 건을 한꺼번에 찾은 것처럼 말하지 않는다").not.toMatch(
      /(?:세|3|셋|여러)\s*가지를? 찾았어요/u,
    );

    // ## 있으면 안 되는 것
    //
    // 2026-08-27 적대적 검증에서 제일 위험했던 변형: 확인 계약 문장을 **그대로 두고**
    // 뒤에 "급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요"를 붙였다. 있어야 할
    // 문장만 세던 옛 검사는 전부 초록이었고, 제품 계약(아모라는 사용자 확인 없이
    // 아무것도 바꾸지 않는다)은 랜딩에서 정면으로 뒤집혀 있었다.
    //
    // "바로 반영"은 금지어가 아니다 — "한 분이 확인했을 때 바로 반영되고"는 참이다.
    // 금지되는 것은 **확인을 건너뛰는 것**이다.
    for (const reversal of [
      /확인[^"]{0,14}(?:건너뛰|생략|안 해도|않아도|없이)/u,
      /승인[^"]{0,14}(?:건너뛰|생략|없이)/u,
      /(?:자동으로|알아서|묻지 않고|먼저)[^"]{0,10}(?:반영|변경|바꿔|수정)/u,
    ]) {
      expect(
        content,
        `확인 계약을 뒤집는 문장이 붙었다: ${String(reversal)}`,
      ).not.toMatch(reversal);
    }

    // 화면이 스스로 "아직 반영 전"이라고 말한다. 옛 데모는 상태 전환으로,
    // 새 카드는 정지된 그림으로 같은 것을 말한다.
    expect(confirmCopy).toContain("아직 반영 전");
    expect(confirmSection).toContain("확인을 누르기 전까지 예산 화면은 그대로예요");

    // 예시라는 것도 말한다(옛 "기능 예시 · 이 화면에서는 실제로 저장되지 않아요").
    expect(confirmCopy).toContain("이름·금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요");
    expect(oneRoom).toContain("이름·금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요");

    // 확인·나중에는 눌리는 버튼이 아니라 그림이다. 진짜 버튼처럼 읽히면
    // 보조기기 사용자는 여기서 승인이 된다고 오해한다.
    //
    // 옛 검사는 `aria-hidden="true"[\s\S]*?confirm.sample.confirm` 이었다 — "앞
    // 어딘가에 있나"만 물어서 **엉뚱한 장식이 대신 답했고**, 가짜 승인 버튼이
    // 보조기기에 노출된 채 초록불이었다. 이제 조상 사슬에서 실제로 찾는다.
    for (const fake of ["confirm.sample.confirm", "confirm.sample.later"]) {
      const chain = renderChain(confirmSection, fake);
      expect(
        chain.some((tag) => /aria-hidden=\{?["']?true/u.test(tag.attrs)),
        `가짜 버튼 ${fake} 가 aria-hidden 안에 있지 않다 — 보조기기가 승인 버튼으로 읽는다`,
      ).toBe(true);
    }
    expect(confirmSection, "랜딩 데모에 진짜 버튼을 두지 않는다").not.toMatch(/<button/u);
    expect(confirmSection, "랜딩 데모에 진짜 버튼을 두지 않는다").not.toMatch(/role="button"/u);

    // 랜딩 데모는 저장도 네트워크 호출도 하지 않는다. 옛 계약은 히어로 데모 하나만
    // 봤고, 그다음 판은 네 파일만 봤다. 데모가 어디로 옮겨 가도 잡히게 폴더 전체를 센다.
    for (const forbiddenPersistenceOrNetworkCall of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "navigator.sendBeacon",
      "XMLHttpRequest",
      "FormData",
      "fetch(",
      "anthropic",
      "openai",
    ]) {
      for (const [file, text] of everyComponent) {
        expect(
          text.toLowerCase(),
          `${file}: 랜딩이 ${forbiddenPersistenceOrNetworkCall}에 손댔다`,
        ).not.toContain(forbiddenPersistenceOrNetworkCall.toLowerCase());
      }
    }
  });

  it("keeps analytics bounded to a non-sensitive source label", () => {
    // 랜딩 클릭 계측이 TrackedLandingLink 한 곳으로 모였다. 옛 히어로는 날짜 입력을
    // 들고 있어 페이로드에 사용자 입력이 실릴 위험이 실제로 있었고, 폼이 사라져도
    // 그 위험은 "링크마다 필드를 하나씩 더 붙이는" 방식으로 돌아온다.
    //
    // 옛 검사는 `captureEvent("name", { … })` **리터럴만** 읽었다. 그래서
    // `captureEvent("name", payload)` 처럼 변수로 넘기면 계측이 아예 안 보였고,
    // 페이로드에 무엇이 실리든 통과했다. 이제 호출 자체를 세고, 리터럴이 아닌
    // 호출은 그 사실로 실패시킨다.
    const calls: Array<{ file: string; args: string[] }> = [];
    for (const [file, text] of everyComponent) {
      let from = 0;
      for (;;) {
        const at = text.indexOf("captureEvent(", from);
        if (at < 0) break;
        from = at + "captureEvent(".length;
        if (/[\w.]/u.test(text[at - 1] ?? "")) continue; // import 문·다른 이름은 건너뛴다

        // 괄호를 맞춰 인자 목록을 통째로 꺼낸다.
        let i = from;
        let depth = 1;
        let quote = "";
        const parts: string[] = [];
        let current = "";
        while (i < text.length && depth > 0) {
          const c = text[i];
          if (quote) {
            if (c === "\\") {
              current += c + (text[i + 1] ?? "");
              i += 2;
              continue;
            }
            if (c === quote) quote = "";
            current += c;
          } else if (c === '"' || c === "'" || c === "`") {
            quote = c;
            current += c;
          } else if ("({[".includes(c)) {
            depth += 1;
            current += c;
          } else if (")}]".includes(c)) {
            depth -= 1;
            if (depth === 0) break;
            current += c;
          } else if (c === "," && depth === 1) {
            parts.push(current);
            current = "";
          } else {
            current += c;
          }
          i += 1;
        }
        parts.push(current);
        calls.push({ file, args: parts.map((p) => p.trim()).filter((p) => p.length > 0) });
      }
    }

    // 옛 계약은 2건 이상이었다(시작 클릭 + 데모 반영 클릭). 데모가 없어져 반영 클릭이
    // 사라졌으므로 하한을 1로 내린다 — 계측이 통째로 사라지는 것은 여전히 막는다.
    expect(calls.length, "랜딩 클릭 계측이 통째로 사라졌다").toBeGreaterThanOrEqual(1);

    for (const { file, args } of calls) {
      expect(args.length, `${file}: captureEvent 인자가 2개가 아니다 — ${args.join(" | ")}`).toBe(2);
      expect(args[0], `${file}: 이벤트 이름이 문자열 리터럴이 아니다 — ${args[0]}`).toMatch(
        /^"[\w.]+"$/u,
      );
      // 페이로드는 **그 자리에 적힌 객체 리터럴**이어야 한다. 변수로 넘기면
      // 무엇이 실리는지 이 파일에서 볼 수 없고, 그것이 지난번 구멍이었다.
      expect(
        args[1],
        `${file}: 계측 페이로드가 객체 리터럴이 아니다 — 변수로 넘기면 무엇이 실리는지 검사할 수 없다: ${args[1]}`,
      ).toMatch(/^\{[\s\S]*\}$/u);
      const payloadKeys = args[1]
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => (entry.split(":")[0] ?? "").trim());
      expect(payloadKeys, `${file}의 계측 이벤트는 source만 전송해야 함`).toEqual(["source"]);
    }
  });

  it("keeps headline and trust-critical copy readable on mobile", () => {
    const h1 = hero.match(/<h1[\s\S]*?<\/h1>/u)?.[0] ?? "";
    expect(h1).not.toContain("whitespace-nowrap");

    // 신뢰 문구 — AI 고지·개인정보 고지·샘플 고지는 어느 폭에서도 숨거나 8~10px로
    // 줄어들면 안 된다.
    //
    // 대상 목록을 손으로 적지 않는다. landingContent 의 각 블록에서 note/notice 계열
    // 키를 뽑아, **그 값을 실제로 그리는 컴포넌트가 있는지**부터 확인한다. 옛 검사는
    // 카피에 문장이 남아 있으면 그것을 그리는 `<p>` 를 지워도 통과했다(변형 갈래 ⑤).
    const noticeMarkers = contentKeys.flatMap((key) =>
      [...block(key).matchAll(/^ {4}(\w*(?:[Nn]ote|[Nn]otice)\w*):/gmu)].map(
        (m) => `${key}.${m[1]}`,
      ),
    );
    expect(noticeMarkers.length, "landingContent 에서 고지 문구를 하나도 찾지 못했다").toBeGreaterThan(
      5,
    );

    for (const marker of noticeMarkers) {
      const renderers = everyComponent.filter(([, text]) => text.includes(marker));
      expect(
        renderers.map(([file]) => file),
        `${marker} 를 그리는 컴포넌트가 없다 — 카피만 남고 화면에서 사라졌다`,
      ).not.toEqual([]);

      for (const [file, text] of renderers) {
        expectVisible(file, text, marker);
        for (const tag of renderChain(text, marker)) {
          expect(
            classNameOf(tag),
            `${file}: ${marker}가 읽을 수 없는 크기다`,
          ).not.toMatch(UNREADABLE_TEXT);
        }
      }
    }

    // 공용 껍데기가 감추면 위 검사가 파일 안에서는 못 본다. notebook 은 어떤 className
    // 에서도 감추지 않는다.
    for (const value of classValues(notebook)) {
      expect(value, "notebook.tsx 의 공용 껍데기가 무언가를 감춘다").not.toMatch(HIDING_UTILITY);
    }
  });

  it("leads with the first-visit outcome and keeps the account-beta boundary after the CTA", () => {
    const heroCopy = block("hero");
    const confirmCopy = block("confirm");

    // 첫 문단은 "무엇을 하면 무엇이 나오는지"만 말한다. 그리고 출력을 **개수가
    // 아니라 이름으로** 말해야 한다.
    expect(heroCopy).toContain("스무 장면에 각자 답하면");
    expect(heroCopy).toContain("고른 문장 그대로 나란히 보여드려요");
    expect(heroCopy, "산출물을 개수로만 말하면 안 된다").not.toMatch(/(?:세|3|셋)\s*가지/u);

    // 계정이 필요한 이야기는 첫 화면에 없다. 히어로 후크는 로그인 없이 만져지는
    // 것이고, 계정 이야기를 여기서 꺼내면 그 사실이 흐려진다.
    expect(heroCopy).not.toContain("계정 베타");
    expect(hero).not.toContain("계정 베타");

    // 경계 문구는 사라지지 않는다. 위계만 CTA 아래로 — 이제 히어로 안이 아니라
    // ⑤ 확인 섹션으로 내려갔다.
    expect(confirmCopy).toContain(
      "계정 베타에서는 예산·할 일·일정 중 한 번에 한 가지 변경을 제안하고",
    );
    expect(confirmCopy).toContain("확인한 변경만 준비 기록에 반영해요");

    // 히어로 안에서도 설명이 CTA 앞에 온다.
    //
    // `indexOf` 를 그냥 비교하면 안 된다 — 설명을 통째로 지우면 -1 이 되고
    // `-1 < 어떤 값` 이라 **문단이 사라진 쪽이 통과한다**. 존재부터 확인한다.
    const bodyAt = hero.indexOf("hero.body");
    const ctaAt = hero.indexOf("hero.primary.href");
    expect(bodyAt, "히어로가 hero.body 를 그리지 않는다").toBeGreaterThanOrEqual(0);
    expect(ctaAt, "히어로가 CTA 를 그리지 않는다").toBeGreaterThanOrEqual(0);
    expect(bodyAt).toBeLessThan(ctaAt);

    // 페이지 순서로도 경계가 CTA 뒤다. 확인 섹션이 히어로 앞으로 올라오면
    // 처음 온 사람이 계정 이야기부터 읽는다. 주석으로 꺼 놓은 섹션은 세지 않는다.
    expect(sectionIndex("ConfirmSection")).toBeGreaterThan(sectionIndex("TransformationHero"));
  });

  it("keeps the headline and the primary action inside the first 320px viewport", () => {
    // 320x568에서 헤드라인부터 기본 CTA까지가 첫 화면 안에 들어와야 한다.
    //
    // 옛 히어로는 날짜 폼과 데모를 함께 들고 있어서 실측(320px에서 CTA bottom
    // 503 < 568)으로 여백 예산을 고정했다. 2026-08-27 개편으로 폼도 데모도 없어져
    // 그 값들(gap-8 pb-12 pt-5 …)은 존재하지 않는다. 아래는 **지금 구현의 예산**이고,
    // 하나라도 커지면 CTA가 첫 화면 밖으로 밀린다. 새 히어로의 브라우저 실측은
    // 아직 없으므로 이 값들은 "조용한 증가를 막는 고정"이지 실측 결과가 아니다.
    expect(hero).toContain("pb-60 pt-12 sm:pt-16 lg:pb-20");
    // H1 곡선의 하한이 320px에서 실제로 쓰이는 값이다(6.4vw = 20.5px < 2rem).
    expect(hero).toMatch(/<h1[^>]*text-\[clamp\(2rem,/u);
    expect(hero).toMatch(/mt-7 max-w-\[46ch\] \$\{bodyText\}/u);
    expect(hero).toMatch(/className="mt-9 flex flex-col gap-3 sm:flex-row/u);

    // 장식은 흐름에서 빠져 있어야 한다. 부케가 static이 되면 320px에서 260px를
    // 그대로 아래로 밀어낸다.
    expect(hero).toMatch(/<BouquetCorner className="pointer-events-none absolute/u);

    // CTA 위 요소를 **통째로 고정**한다.
    //
    // 옛 검사는 `<h1`·`<p` **태그 이름만** 셌다. 그래서 문단을 `<div>` 로 넣으면
    // CTA 를 아래로 밀면서도 통과했다(2026-08-27 변형). 이제 여는 태그 열을 그대로
    // 대조한다 — 무엇을 끼워 넣든 열이 달라진다.
    //
    // 히어로 배치를 일부러 바꿨다면 이 배열을 함께 고쳐라. 고치는 순간
    // "CTA 가 첫 화면 안에 남는가"를 다시 재 봐야 한다는 뜻이다.
    const aboveCta = hero.slice(hero.indexOf("${shell} relative"), hero.indexOf("hero.primary.href"));
    expect(aboveCta.length, "히어로에서 CTA 위 구간을 잘라내지 못했다").toBeGreaterThan(0);
    const tagsAboveCta = [...aboveCta.matchAll(/<([A-Za-z][\w.]*)/gu)].map((m) => m[1]);
    expect(tagsAboveCta, "CTA 위 요소가 늘면 320px에서 CTA가 밀린다").toEqual([
      "p",
      "h1",
      "br",
      "br",
      "span",
      "p",
      "div",
      "Link",
    ]);
  });

  it("drives every landing headline from one display scale", () => {
    // 이전에는 8개 섹션이 각자 다른 clamp 곡선·leading·tracking을 썼고, 그 결과
    // 1280px 실측에서 신뢰(72px)·마무리(73.6px)가 H1(68px)보다 커지는 위계 역전이
    // 있었다. 랜딩에서 가장 큰 타입은 언제나 H1이어야 한다.
    //
    // 곡선의 정본이 옮겨졌다: landingType.ts(displayHero/displaySection/displayMuted)는
    // 이제 아무도 import 하지 않고, notebook.tsx의 sectionTitle·bodyText가 그 자리를
    // 잇는다. H1 곡선만 히어로가 직접 들고 있다.
    const heroMax = clampMaxRem("H1", hero.match(/<h1[^>]*?text-\[clamp\(([^)]*)\)\]/u)?.[1]);
    const sectionMax = clampMaxRem(
      "sectionTitle",
      notebook.match(/export const sectionTitle\s*=[\s\S]*?clamp\(([^)]*)\)/u)?.[1],
    );
    const bodyMax = clampMaxRem(
      "bodyText",
      notebook.match(/export const bodyText\s*=[\s\S]*?clamp\(([^)]*)\)/u)?.[1],
    );

    expect(sectionMax).toBeLessThan(heroMax);
    expect(bodyMax).toBeLessThan(sectionMax);

    // 섹션 컴포넌트는 자기만의 곡선을 새로 만들지 않는다. 새 크기가 필요하면
    // notebook.tsx에 넣고 거기서 가져온다 — 그래야 위계가 한 곳에서 보인다.
    // 한 파일에서 멈추지 않고 전부 모아서 한 번에 보인다. 첫 파일에서 끊으면
    // 남은 위반이 초록불 뒤에 숨는다.
    const inlineCurves = sectionSources.flatMap(([file, text]) =>
      [...text.matchAll(/text-\[clamp\([^\]]*\)\]/gu)].map((m) => `${file}: ${m[0]}`),
    );
    expect(inlineCurves, "섹션이 인라인 clamp 곡선을 다시 만들었다").toEqual([]);
    for (const [file, text] of sectionSources) {
      expect(text, `${file}이 공용 타입 스케일을 쓰지 않는다`).toMatch(/from "\.\/notebook"/u);
    }

    // 한글 헤드라인 고아 글자 방지. keep-all은 어절 단위로만 끊고, 마지막 줄에
    // 한 어절만 남는 것("… 해야 할 / 일.")은 text-balance가 막는다.
    expect(notebook).toMatch(/export const sectionTitle\s*=[\s\S]*?text-balance/u);
    expect(hero).toMatch(/<h1[^>]*text-balance/u);
  });

  it("actually disables the unlayered animations under prefers-reduced-motion", () => {
    // globals.css는 .animate-fade-in 등을 @layer 밖에서 선언한다. cascade layer
    // 규칙상 layer 밖 선언이 항상 이기므로 Tailwind가 @layer utilities에 넣는
    // `motion-reduce:animate-none`은 이들을 덮지 못한다. 실제 Chrome에서
    // reduced motion인데도 animation-name이 fadeIn으로 남는 것을 확인했다.
    // 따라서 같은 unlayered 위치의 @media 블록으로 꺼야 한다.
    const globals = readFileSync(resolve(APP_ROOT, "src/app/globals.css"), "utf8");
    const reduceBlock = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/u,
    )?.[0];
    expect(reduceBlock, "prefers-reduced-motion 블록을 찾지 못함").toBeTruthy();

    const unlayered = [...globals.matchAll(/^\.([a-zA-Z][\w-]*)\s*\{\n\s*animation:/gmu)]
      .map((m) => m[1])
      .filter((cls) => !cls.startsWith("c6-"));
    expect(unlayered.length, "unlayered animation 클래스를 찾지 못함").toBeGreaterThan(0);

    for (const cls of unlayered) {
      expect(
        reduceBlock ?? "",
        `.${cls}이 prefers-reduced-motion에서 꺼지지 않는다`,
      ).toContain(`.${cls}`);
    }
  });

  it("does not ship motion-reduce classes that target the wrong property", () => {
    // Tailwind v4의 translate-* 유틸리티는 `transform`이 아니라 독립 `translate`
    // 속성을 쓴다. 그래서 `motion-reduce:transform-none`은 아무것도 되돌리지
    // 못하고, group-hover 변형보다 특이도도 낮다. 이동 자체를 `motion-safe:`로
    // 감싸는 것이 유일하게 동작하는 형태다.
    for (const [file, text] of motionSources) {
      for (const value of classValues(text)) {
        expect(value, `${file}: motion-reduce:transform-none은 무효 클래스다`).not.toMatch(
          /motion-reduce:transform-none/u,
        );
        const moves = [...value.matchAll(/(?<!motion-safe:)group-hover:translate-[xy]-[\w.[\]-]+/gu)];
        expect(moves.map((m) => m[0]), `${file}: hover 이동은 motion-safe로 감싼다`).toEqual([]);
      }
    }
  });

  it("keeps landing transitions inside the DESIGN.md motion band", () => {
    // DESIGN.md: micro 80ms / short 160-220ms / medium 300-450ms.
    // Tailwind의 transition-* 기본값은 150ms라 어느 밴드에도 들지 않는다.
    //
    // `transition-none`은 제외한다. 새 랜딩은 모든 전이에
    // `motion-reduce:transition-none`을 붙이는데, 그건 전이를 **끄는** 유틸이라
    // duration을 요구할 대상이 아니다.
    //
    // **요소별로 본다.** 옛 검사는 파일 전체에서 `<유틸> duration-` 을 찾아서,
    // 같은 파일 어딘가에 `transition-colors duration-200` 을 쓴 형제가 하나만
    // 있으면 duration 없는 전이가 통째로 안 보였다(2026-08-27 변형).
    for (const [file, text] of motionSources) {
      for (const value of classValues(text)) {
        const transitions = [...value.matchAll(/(?:^|\s)(?:[\w[\]@&().#%/*+~:-]+:)?(transition(?:-[a-z[][^\s"`]*)?)/gu)]
          .map((m) => m[1])
          .filter((util) => util !== "transition-none");
        if (transitions.length === 0) continue;
        expect(
          /(?:^|\s)(?:[\w[\]@&().#%/*+~:-]+:)?duration-/u.test(value),
          `${file}에 duration 없는 transition이 남아 있다: ${transitions.join(", ")} — "${value}"`,
        ).toBe(true);
      }
    }
  });

  it("keeps the hero to one column and puts the evidence right after it", () => {
    // 옛 히어로는 2단이었다 — 왼쪽 글, 오른쪽 결과 패널. 그래서 "작은 화면에서
    // 결과를 먼저"라는 계약이 min-h·grid-cols·max-w 값으로 고정돼 있었다.
    // 새 히어로는 어느 폭에서도 한 단이고, 결과(장면 예시)는 컬럼이 아니라
    // **바로 다음 섹션**이다. 지켜야 할 것은 같다: 첫 화면 다음에 곧바로 증거가 온다.
    expect(hero, "히어로는 어느 폭에서도 한 단이다").not.toMatch(/\bgrid\b/u);

    // `grid` 하나만 막던 시절에는 `lg:flex lg:flex-row` 로 단을 나누면 통과했다.
    // 본문(H1·설명)을 감싼 **조상** 중 어느 것도 단을 나누지 않아야 한다.
    // CTA 줄의 `sm:flex-row`(버튼 두 개를 옆으로)는 조상이 아니라서 여기 안 걸린다.
    for (const marker of ["hero.body", "<h1"]) {
      for (const tag of renderChain(hero, marker)) {
        expect(
          classNameOf(tag),
          `히어로 본문을 <${tag.name}> 이 여러 단으로 나눈다`,
        ).not.toMatch(/(?:^|\s)(?:[\w[\]@&().#%/*+~:-]+:)?(?:grid|flex-row|columns-\w+)(?=\s|$)/u);
      }
    }

    // 주석으로 꺼 놓은 섹션은 세지 않는다. 렌더되는 순서만 본다.
    const heroAt = sectionIndex("TransformationHero");
    expect(sectionIndex("ScenesSection")).toBeGreaterThan(heroAt);
    expect(
      renderedSectionNames[heroAt + 1],
      "히어로와 장면 예시 사이에 다른 섹션이 끼면 증거가 첫 화면에서 멀어진다",
    ).toBe("ScenesSection");
  });

  it("shows the two-person scene on mobile, because the H1 promises it", () => {
    // 이전 계약은 대화 컬럼을 `hidden ... md:block`으로 숨겨 히어로를 짧게 유지했다.
    // 그런데 H1이 "둘이 말하면"이라 두 사람이 말하는 장면이 모바일에서 사라지면
    // 첫 화면의 약속과 증거가 어긋난다. H1이 "둘의 기준이 다른 걸 몰라서"로 바뀐
    // 지금도 약속은 같다 — 두 사람이 나오는 장면이 모바일에 보여야 한다.
    //
    // 옛 검사는 `className="[^"]*(?:^|\s)(?:[a-z]+:)?hidden(?:\s|$)[^"]*"` 였다.
    // `^` 가 문자열 시작이라 className **맨 앞**의 hidden 을 못 봤고, 템플릿 리터럴
    // className 은 아예 안 봤다. 그래서 `className="hidden lg:block"` 으로 이 장면을
    // 모바일에서 감춰도 통과했다 — 이 주석이 경고한 바로 그 회귀가 초록불이었다.
    for (const [file, text] of [
      ["ScenesSection.tsx", scenes] as const,
      ["OneRoomSection.tsx", oneRoom] as const,
    ]) {
      for (const value of classValues(text)) {
        expect(value, `${file}: 두 사람 장면을 폭으로 감추지 않는다`).not.toMatch(HIDING_UTILITY);
      }
    }

    // 장면 자체는 두 사람과 두 발화가 모두 있어야 한다. 이름(민지·현우)이 역할
    // (신부·신랑)로 바뀐 것은 2026-08-27 개편이고, "두 사람이 각각 말한다"는
    // 계약은 그대로다.
    for (const line of [
      "화요일 밤 · 신부",
      "수요일 아침 · 신랑",
      "예식장 견적이 800 더 나왔어. 오늘은 얘기 못 하겠다.",
      "어제 그거 봤어. 어디를 줄이면 될까?",
    ]) {
      expect(oneRoom, `데모 대화에서 ${line}이 빠졌다`).toContain(line);
    }

    // 장면 하나는 첫 화면 바로 다음에서 실제 문항 그대로 보여준다.
    // 카피에 있는 것만으로는 부족하다 — 그리는 자리도 함께 본다.
    //
    // **문장을 옮겨 적지 않는다.** 여기 적었던 문장은 라이브 문항이 아니라
    // 지어낸 것이었고, 그래서 랜딩이 틀린 견본을 보여 주는데도 통과했다.
    // 라이브와의 대조는 `landingSampleMatchesLive.test.ts` 가 전담한다.
    expect(block("scenes")).toMatch(
      /scene:\s*"[^"]{16,}"/u,
    );
    expect(scenes).toContain("scenes.sample");
    expectVisible("ScenesSection.tsx", scenes, "scenes.sample");
  });

  it("keeps the source helper in charge — no private comment stripper comes back", () => {
    // 이 파일이 자기 `withoutComments` 를 갖고 있던 시절, 그 복사본은 줄 **처음**의
    // `//` 만 지웠다. 줄 끝 주석 한 줄이면 어떤 계약도 무력화됐다.
    // 여섯 벌이 전부 같은 버그였고, 다시 생기면 같은 일이 반복된다.
    const self = source("src/app/landing/__tests__/landingHeroExperience.test.ts");

    // 금지 이름을 이어 붙여 만든다. 정규식 리터럴로 적으면 **그 리터럴 자신이**
    // 파일 안에 남아 검사가 자기 자신을 잡는다(처음에 실제로 그렇게 만들었다).
    for (const banned of ["withoutComments", "stripLandingComments"]) {
      expect(
        self,
        `주석 제거기를 다시 복사하지 마라(${banned}) — landingSource.ts 를 import 하라`,
      ).not.toMatch(new RegExp(`function\\s+${banned}\\b`, "u"));
    }
    expect(
      self,
      "contentBlock 을 다시 복사하지 마라 — 경계를 못 찾으면 던져야 한다",
    ).not.toMatch(new RegExp(`function\\s+${"contentBlock"}\\b`, "u"));
    expect(self, "공용 도구를 import 하지 않는다").toMatch(/from "\.\/landingSource"/u);

    // 헬퍼가 실제로 줄 끝 주석을 지우는지 이 파일 기준으로도 확인한다.
    // (`landingSource.test.ts` 가 본 검사를 하지만, 여기서 쓰는 상수들이 정말
    //  주석 벗긴 것인지는 여기서 한 번 더 확인해 둘 값어치가 있다.)
    expect(stripComments('const a = 1; // 예산\n'), "줄 끝 주석이 남는다").not.toContain("예산");
    expect(hero, "히어로 상수가 주석을 그대로 들고 있다").not.toContain("도구 이름(예산");
    // 폴더를 읽는 목록이 비면 아래 검사들이 전부 빈 반복문이 된다.
    expect(everyComponent.length, "랜딩 컴포넌트를 하나도 읽지 못했다").toBeGreaterThan(5);
    expect(renderedSectionNames.length, "page.tsx 가 렌더하는 섹션을 못 읽었다").toBeGreaterThan(5);
  });
});
