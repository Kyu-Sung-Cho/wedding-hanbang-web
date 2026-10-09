// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LandingPage from "../page";
import TransformationHero from "@/components/landing/redesign/TransformationHero";
import LandingBloomLayer from "@/components/landing/redesign/LandingBloomLayer";
import { landingContent } from "@/components/landing/redesign/landingContent";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

function heroDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(TransformationHero)), "text/html");
}

describe("처음 방문한 사람이 보는 준비 흐름", () => {
  it("예시는 발언하지 않은 조건·동기를 추정하지 않고 견적 도구의 직접 선택을 설명한다", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    const amora = doc.querySelector("#amora")?.textContent ?? "";
    expect(amora).not.toMatch(/시기랑 예산을 그대로 이어받아|식장은 아직 안 봐도/u);
    expect(amora).toContain("드레스 피팅비가 안 보여");
    expect(amora).toMatch(/피팅비가 견적에 포함됐는지[^.]*1회 비용과 결제 시점/u);
    expect(amora).toContain("확인할 내용");
    expect(amora).not.toMatch(/피팅비는\s*[\d,]+\s*원/u);
    expect(amora).toContain("견적서는 사진·PDF로 올려 질문하세요");
    expect(amora).toContain("포함된 항목이나 추가 비용");
    expect(amora).toContain("아모라 · AI 생성");
    expect(amora).toContain("기능을 설명하는 예시 대화예요");
    const discussion = doc.querySelector("#noside")?.textContent ?? "";
    expect(discussion).not.toMatch(/두 분 다[^.]*후회 안 할/u);
    expect(discussion).toMatch(/식장과 사진에 각각 얼마까지 쓸 수 있는지/u);
    expect(discussion).toContain("아모라 · AI 생성");
    expect(discussion).toContain("실제 이용자의 대화가 아니에요");
    const quoteTool = doc.querySelector('#now a[href="/wedding/community/quote-check"]')?.textContent ?? "";
    expect(quoteTool).toMatch(/항목별로 포함 여부와 이용 계획/u);
    expect(quoteTool).toContain("업체에 물어볼 질문");
    expect(quoteTool).not.toMatch(/견적서[^.]*짚어주|자동[^.]*분석/u);
  });

  it("첫 화면에서 아모라를 이해하고 가입 없이 웨딩코드를 시작할 수 있다", () => {
    const doc = heroDocument();
    const copy = doc.body.textContent ?? "";
    expect(copy).toMatch(/AI[\s\S]*아모라/u);
    expect(copy).toMatch(/예산·일정·할 일[\s\S]*직접 확인해 기록/u);
    const titleLines = [...doc.querySelectorAll("h1 > span")].map((line) => line.textContent);
    expect(titleLines).toEqual(["결혼 준비, 뭐부터 할까요?", "아모라와 하나씩 정해요."]);
    expect(doc.querySelector(".landing-tape")?.textContent).toBe("결혼 준비 동반자, 아모라");
    expect(copy).toContain("내가 원하는 결혼식부터");
    expect(copy).toContain("필요한 계획을 직접 확인해 기록하세요");
    expect(doc.querySelector('a[href="/wedding/chat"]')?.textContent).toContain("아모라");
    const weddingCode = doc.querySelector('a[href="/wedding-code"]');
    expect(weddingCode?.textContent).toBe(landingContent.hero.secondary.label);
    const page = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    expect(page.querySelector('header a[href="#amora"]')?.textContent).toContain("아모라");
  });

  it("첫 화면 예시는 미정인 첫 질문부터 시작하며 실제 대화나 저장으로 오해되지 않는다", () => {
    const preview = heroDocument().querySelector("figure");
    expect(preview).toBeTruthy();
    const copy = preview?.textContent ?? "";
    expect(copy).toContain("하객은 100명 정도야");
    expect(copy).toContain("아모라의 답변 · AI 생성");
    expect(copy).toContain("예산 범위부터 잡아 봐요");
    expect(copy).toContain("아직 미정");
    expect(copy).toContain("기능을 설명하는 예시예요");
    expect(copy).toContain("AI 답변에는 오류가 있을 수 있어요");
    expect(copy).not.toContain("배정 예산");
    expect(copy).toContain("이 화면에서는 대화하거나 저장할 수 없어요");
    expect(copy).not.toMatch(/D-\d+|\d+%|\d+건/u);
  });

  it("중복 첫 행동 섹션 없이 공개 도구 네 개의 계정 조건을 보여 준다", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    expect(doc.querySelector("#reasons")).toBeNull();
    const tools = [...doc.querySelectorAll("#now a[href]")].filter((link) =>
      ["/wedding/community/quote-check", "/wedding-code", "/price", "/wedding/manners"].includes(link.getAttribute("href") ?? ""));
    expect(tools.map((link) => link.getAttribute("href"))).toEqual([
      "/wedding/community/quote-check", "/wedding-code", "/price", "/wedding/manners",
    ]);
    expect(doc.querySelector("#now")?.textContent).toContain("가입 없이 먼저 써 보세요");
  });

  it("아모라 가치와 두 사람의 우선순위 뒤에 실제 관리 도구를 설명한다", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    const ids = [...doc.querySelectorAll("main > section")].map((section) => section.id);
    expect(ids.slice(0, 4)).toEqual(["", "amora", "noside", "confirm"]);
    const confirmation = doc.querySelector("#confirm")?.textContent ?? "";
    expect(confirmation).toContain("저장 전");
    expect(confirmation).toContain("예산 → 결혼식장");
    expect(confirmation).toMatch(/한 명이 저장[\s\S]*변경 알림/u);
  });

  it("실제 관리 도구 네 개를 열 수 있고 확인 전 제안은 기록을 바꾸지 않는다", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    const confirm = doc.querySelector("#confirm");
    const cards = [...(confirm?.querySelectorAll(":scope > div > ul > li") ?? [])];
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.querySelector("a")?.getAttribute("href"))).toEqual([
      "/wedding/budget", "/wedding/checklist", "/wedding/schedule", "/wedding/chat/board",
    ]);
    for (const [index, card] of cards.entries()) {
      const tool = landingContent.confirm.management[index];
      const copy = card.textContent ?? "";
      expect(copy).toContain(tool.title);
      expect(copy).toContain(tool.body);
      expect(card.querySelector("a")?.textContent).toBe(tool.action);
      expect(card.querySelector("a")?.className).toContain("min-h-11");
      expect(card.querySelector("a")?.className).toContain("focus-visible:ring-2");
    }
    expect(confirm?.textContent).toContain("저장을 확인하기 전에는 기록이 바뀌지 않아요");
    expect(confirm?.textContent).toContain("파트너와 연결한 뒤에는 두 사람 중 한 명이 저장하면 공동 기록에 반영돼요");
    expect(confirm?.textContent).toContain("파트너도 앱에서 변경 알림을 볼 수 있어요");
    expect(confirm?.querySelector("button")).toBeNull();
  });

  it("가입 후 아모라 시작 절차를 세 단계로 안내하고 첫 행동과 끝 행동이 같다", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    const steps = [...doc.querySelectorAll('ol[aria-label="아모라 시작 순서"] > li')]
      .map((step) => step.textContent?.replace(/^0[1-3]/u, "").trim());
    expect(steps).toEqual([
      "가입하고 시작 설정하기",
      "아모라에게 지금 고민 말하기",
      "필요한 제안만 확인해 저장하기",
    ]);
    const signupLinks = [...doc.querySelectorAll('a[href="/wedding/chat"]')];
    expect(signupLinks.some((link) => link.textContent?.includes(landingContent.hero.primary.label))).toBe(true);
    expect(signupLinks.some((link) => link.textContent?.includes(landingContent.closing.primary.label))).toBe(true);
  });

  it("개인 상담 비노출 고지는 개인 카드에만 붙고 공유 카드는 함께 보임을 설명한다", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    const lanes = [...doc.querySelectorAll("#amora li")];
    const shared = lanes.find((lane) => lane.textContent?.includes("함께 보는 대화"));
    const personal = lanes.find((lane) => lane.textContent?.includes("나만 보는 상담"));
    expect(shared?.textContent).toContain("같은 대화방에서 이야기할 수 있어요");
    expect(shared?.textContent).not.toContain("배우자 화면에는 표시하지 않아요");
    expect(personal?.textContent).toContain("개인 상담도 서비스에서 처리·저장돼요");
    expect(personal?.textContent).toContain("파트너에게 표시되지 않아요");
  });
});

/** 값의 위계를 검사한다. 픽셀 위치·글꼴 로딩·줄바꿈 실측은 브라우저 QA의 몫이다. */
function headingSizeAt(element: Element, viewport: number): number {
  const breakpoints: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280 };
  const length = (value: string) => value.endsWith("rem") ? parseFloat(value) * 16
    : value.endsWith("vw") ? parseFloat(value) * viewport / 100 : parseFloat(value);
  let size: number | undefined;
  let priority = -1;
  for (const token of element.classList) {
    const match = /^(?:(sm|md|lg|xl):)?(!?)text-\[(\d+(?:\.\d+)?(?:px|rem)|clamp\([^)]+\))\](!?)$/u.exec(token);
    if (!match) continue;
    const minimum = match[1] ? breakpoints[match[1]] : 0;
    const rank = minimum + (match[2] || match[4] ? 10000 : 0);
    if (minimum > viewport || rank < priority) continue;
    const raw = match[3];
    if (raw.startsWith("clamp(")) {
      const [min, preferred, max] = raw.slice(6, -1).split(",").map(length);
      size = Math.max(min, Math.min(preferred, max));
    } else {
      size = length(raw);
    }
    priority = rank;
  }
  expect(size, "rendered heading needs a measurable font size").toBeDefined();
  return size!;
}



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
 * 실제 렌더된 제목·진입 링크·예시의 순서를 검사하고, 카피의 사실성·개인정보·
 * 승인 계약은 공용 landingSource 도구로 별도 보호한다.
 * 2026-09-06 승인 HTML에 맞춰 옛 클래스·clamp 모양을 고정하던 검사는 없앴다.
 * SSR에서 픽셀 위치를 실측했다고 주장하지 않는다.
 */

function redesign(fileName: string): string {
  return rendered(`src/components/landing/redesign/${fileName}`);
}

const hero = redesign("TransformationHero.tsx");

/**
 * 첫 화면에서 금지되는 **도구 이름**들. 목록이지 정규식 하나가 아닌 이유는
 * "몇 개나 늘어놓았는지"를 세야 하기 때문이다(아래 케이스 참조).
 */
const TOOL_NAMES = ["예산", "할 일", "일정", "체크리스트"] as const;

/** 주어진 글에 등장하는 도구 이름들(중복 없이, 목록 순서대로). */
function toolNamesIn(text: string): string[] {
  return TOOL_NAMES.filter((name: string) => text.includes(name));
}
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

/**
 * 옛 `ScenesSection`·`OneRoomSection`·`PriceCompareSection` 이 지던 것을 지금 지는 곳.
 *
 *  - 두 사람이 나오는 장면(민지·현우 대화)  → `ConfirmSection` 의 "둘이 말한 것" 카드
 *  - 히어로 바로 다음의 증거(장면 문항)      → `AmoraNoteSection` 의 노트 카드
 *  - 로그인 없이 열리는 것들의 고지          → `AvailableNowSection` 의 카드 넷
 */
const confirmSection = componentSource("ConfirmSection.tsx");
const amoraNoteSection = componentSource("AmoraNoteSection.tsx");
const availableNowSection = componentSource("AvailableNowSection.tsx");

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
 * 옛 NoSideSection 의 꽃(`hidden xl:block`)이 실제로 그 창 안에 들어왔다. 2026-08-29
 * 개편으로 꽃이 `LandingBloomLayer` 로 빠져 페이지 전체를 덮으므로, 창 방식이면
 * 더 넓게 샌다. 조상 스택은 형제를 절대 포함하지 않는다.
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
 * 로그인 없이 열리는 것들의 카탈로그.
 *
 * 2026-08-29 개편 전에는 `export const notDoing` ~ `footerLinks` 사이의 **최상위
 * export 배열**이었고, 그래서 `contentBlock("notDoing", "footerLinks")` 로 잘랐다.
 * 지금은 `landingContent.availableNow` 블록 하나가 그 자리를 잇는다 — 카드 넷
 * (견적 점검 · 스무 장면 · 공시 가격 · 예절 가이드). 옛 히어로와 옛
 * `PriceCompareSection` 이 지던 "로그인 없이 만져진다 / 저장하지 않는다 / 점수를
 * 매기지 않는다" 고지들이 전부 여기로 내려왔다.
 */
const availableNowCatalogue = block("availableNow");

describe("landing hero product experience contract", () => {
  it("explains the product in plain language before asking for action", () => {
    const heroCopy = block("hero");
    const confirmCopy = block("confirm");

    // 무엇을 하는 서비스인지 첫 화면에서 말한다. 이 자리는 여러 번 옮겨 다녔다 —
    // 라벨("웨딩한방 · 둘이 함께 관리하는 결혼 준비 공간") → 히어로 본문 첫 문장
    // ("웨딩한방은 둘이 어디서 갈리는지부터 봅니다") → 지금은 테이프 이름표와 본문이
    // 나눠 진다. 문장은 바뀌어도 계약은 같다: **첫 화면이 제품을 설명한다.**
    //
    // **블록 안에서** 찾는다. 파일 전체 toContain 이던 시절에는 이 문장을
    // `footer.tagline` 으로 옮겨도 통과했다 — 첫 화면이 제품을 설명하지 않는데도.
    //
    // 2026-09-03 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)으로 본문이 바뀌었다.
    // 옛 문장은 우리가 무엇을 **펼쳐 주는지**(공시 원문)를 말했고, 새 문장은 우리가
    // 무엇을 **같이 정하는지**를 말한다. 계약은 그대로다 — 첫 화면이 제품을 설명한다.
    expect(heroCopy).toMatch(/AI 동반자 아모라와 고민을 정리하고[^"\n]*직접 확인해 기록/u);
    expect(confirmCopy).toContain("파트너와 연결한 뒤에는");

    // 산출물을 **개수가 아니라 이름으로** 말한다. 이전 문구는 "세 가지"라고만 해서
    // 그 셋이 무엇인지 랜딩 어디에도 없었다. 스무 장면은 2026-08-29 개편에서
    // 히어로 후크 자리를 내주고 "지금 되는 것" 카드 02 로 내려갔다 —
    // **도구가 내려가도 산출물을 이름으로 말하는 계약은 따라간다.**
    expect(availableNowCatalogue).toContain("결혼식 취향과 준비 방식");
    expect(availableNowCatalogue).toContain("파트너도 답하면 같은 생각과 다른 생각을 비교할 수 있어요");
    // 어형·표기를 넓힌다. "세 가지"만 막던 시절에는 "3가지"로 바꾸면 통과했다.
    expect(heroCopy, "첫 화면이 산출물을 개수로만 말하면 안 된다").not.toMatch(
      /(?:세|3|셋)\s*가지/u,
    );
    expect(content, "산출물을 개수로만 말하면 안 된다").not.toMatch(
      /지금 볼\s*(?:세|3|셋)\s*가지/u,
    );

    // 아모라를 소개할 때는 AI라는 말과 함께 소개한다. 이 고지는 라벨
    // ("아모라 · 대화를 정리하는 AI") → `noSide.note` → 다시 히어로 테이프로 돌아왔고,
    // 아모라 카드와 경계 섹션과 푸터가 같은 것을 한 번 더 말한다. 네 자리를 다 본다 —
    // 한 자리만 보면 나머지가 조용히 사라진다.
    expect(heroCopy, "첫 화면이 아모라를 AI라고 말하지 않는다").toMatch(/AI[^"\n]*아모라/u);
    expect(block("amoraNote")).toContain("아모라 · AI 생성");
    expect(block("boundaries")).toContain("아모라의 답변은 AI가 작성해요");
    expect(block("boundaries")).toContain("AI 답변에는 오류가 있을 수 있어요");

    // 목적지를 구체적으로 말하되 사용자 확인을 생략한 자동 저장 약속이 되지 않는다.
    expect(toolNamesIn(heroCopy)).toEqual(["예산", "할 일", "일정"]);
    expect(confirmCopy).toContain("저장을 확인하기 전에는 기록이 바뀌지 않아요");
    for (const tool of ["예산", "할 일", "일정", "제안", "반영"]) {
      expect(confirmCopy, `확인 섹션이 ${tool}을 말하지 않는다`).toContain(tool);
    }

    // 행동을 부르는 문장은 설명 뒤에 오고, 첫 화면과 마무리가 **같은 행동**을 부른다.
    // 다른 걸 부르면 페이지 전체가 무엇을 시키려는 건지 흐려진다.
    //
    // 2026-08-29: 1차 CTA 가 `/wedding-code` → `/price` 로 바뀌었다.
    // 2026-09-03: 시안 원본(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)을 다시 열어 보니
    // 시안의 첫 버튼은 "아모라와 준비 시작하기"(가입)였다 — 앞 줄에 적힌 "가입 없이
    // 물어보기" 는 **내가 시안을 잘못 읽은 것**이고, 시안은 버튼 밑에 "결제 없이 계정
    // 생성" 이라고 적어 첫 행동이 가입임을 분명히 한다. **둘이 같아야 한다**는 계약은
    // 그대로다.
    const primaryCta = 'primary: { label: "아모라와 준비 시작하기", href: "/wedding/chat" }';
    expect(heroCopy).toContain(primaryCta);
    expect(block("closing")).toContain(primaryCta);

    // 감정 문구를 헤드라인 앞에 세우지 않는다. `hero.emotionalLine`은 옛 필드이고
    // 2026-08-27 개편에서 사라졌다 — 되살아나면 여기서 잡는다.
    expect(content).not.toContain("emotionalLine");
  });

  it("keeps the no-login first-step action visible from the smallest breakpoint", () => {
    const heroCopy = block("hero");

    // 로그인 없이 밟을 수 있는 첫 걸음. 이 자리는 날짜 폼(/start-here) → 스무 장면
    // (/wedding-code) → 공시 가격(/price) 으로 옮겨 다녔다. 셋 다 supabase 0 · fetch 0
    // 이라 **로그인 없이 끝까지 만져진다**는 점이 같고, 그것이 계약이다.
    //
    // 2026-09-03 시안은 첫 버튼을 가입("아모라와 준비 시작하기")으로 세운다. 그래서
    // 히어로가 내는 **문 둘 중 하나**가 계정을 요구하게 됐다. 계약을 "둘 다 열려 있다"
    // 에서 "**적어도 하나는 계정 없이 열려 있다**" 로 좁힌다 — 지키려는 해악("처음 온
    // 사람이 첫 화면에서 아무 데도 못 간다")은 문이 하나라도 열려 있으면 일어나지 않고,
    // 둘 다 닫히면 운다 — 그 판정은 `landingFirstVisitClarity.test.ts` 가 진다
    // (거기서 두 버튼을 "로그인 없이 되는 것" 목록과 맞대본다).
    expect(heroCopy).toContain('href: "/wedding-code"');
    expect(hero).toContain("hero.primary.href");

    // 첫 화면의 조건을 CTA 옆에서 말한다. 시안 문장("결제 없이 계정 생성")이 첫 버튼의
    // 조건을 지고, 뒤 문장이 로그인 없이 열린 쪽의 조건을 진다.
    expect(heroCopy).toContain("아모라는 로그인 후 이용해요. 웨딩코드는 가입 없이 해볼 수 있어요");

    // **뒤에 붙여 뒤집는 것**도 막는다. 계약 문장을 그대로 두고 그 뒤에
    // "다만 결과를 보려면 가입해야 해요"를 붙이면 있어야 할 문장 검사는 전부
    // 통과하면서 계약만 죽는다(2026-08-27 변형 갈래 ③).
    expect(heroCopy, "가입 없이 된다고 해 놓고 뒤에서 가입을 요구하지 않는다").not.toMatch(
      /(?:가입|로그인|계정)[^"]{0,12}(?:해야|하셔야|필요해요|필요합니다)/u,
    );

    // "내 답이 어디 있는지" 고지는 히어로에서 "지금 되는 것" 카드로 따라 내려갔다.
    // 옛 히어로의 "답은 이 브라우저에만 있고 저장하지 않아요" · "날짜는 이 브라우저에서
    // 계산에만 쓰고 서버로 보내지 않아요" 가 지키던 것이다 — **도구만 옮기고 고지를
    // 두고 오면 안 된다.** 지금은 카드마다 자기 몫을 진다.
    expect(availableNowCatalogue, "견적 저장 고지가 사라졌다").toContain(
      "가입 없이 선택한 내용은 저장하지 않아요",
    );
    expect(availableNowCatalogue, "웨딩코드 공유 링크 고지가 사라졌다").toContain(
      "함께 보기에 동의하면 답이 서버에 보관·공유돼요",
    );
    expect(availableNowCatalogue, "궁합·심리 진단 금지 고지가 사라졌다").toContain(
      "심리 진단이나 궁합 검사가 아니에요",
    );

    // AI 처리·저장 고지도 사라지지 않는다. 옛 히어로 폼 아래 → `privateLane.note` →
    // 지금은 아모라 카드가 진다. 비로그인 아모라 체험이 2026-08-27에 닫혀
    // "대화 내용은 서비스에서 처리·저장될 수 있어요" 라고 말할 대화가 이 화면에는
    // 없어졌고, 대신 **이 화면의 대화가 샘플이며 저장되지 않는다**고 말한다.
    expect(block("amoraNote")).toContain("이 화면에서는 대화하거나 저장할 수 없어요");

    // CTA는 어느 폭에서도 숨지 않는다 — 자기 className 도, 감싼 래퍼도.
    expectVisible("TransformationHero.tsx", hero, "hero.primary.href");
    // CTA 아래 안내도 마찬가지고, CTA와 떨어지면 안 된다.
    expectVisible("TransformationHero.tsx", hero, "hero.note");
    const heroDoc = heroDocument();
    const primary = heroDoc.querySelector('a[href="/wedding/chat"]');
    const note = [...heroDoc.querySelectorAll("p")].find((paragraph) =>
      paragraph.textContent?.includes("아모라는 로그인 후 이용해요. 웨딩코드는 가입 없이 해볼 수 있어요"),
    );
    expect(primary?.parentElement?.nextElementSibling, "CTA 아래 안내가 CTA와 떨어지면 안 된다")
      .toBe(note);
  });

  it("shows one concrete proposal and marks it unapplied without a live AI call", () => {
    const confirmCopy = block("confirm");

    // 제안은 한 번에 하나다. 옛 히어로 데모의 "각각 별도 제안과 확인이 필요해요"가
    // 지키던 것을 지금은 확인 섹션 본문이 진다.
    expect(confirmCopy).toContain("저장 전에 바뀔 내용과 저장 위치를 직접 확인하면 예산·할 일·일정에 남길 수 있어요");
    expect(confirmCopy).toContain("저장을 확인하기 전에는 기록이 바뀌지 않아요");
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
    //
    // 2026-08-29: 옛 목록의 `먼저` 갈래를 뺐다. 커뮤니티 섹션이 새로 생기며
    // "두 달 먼저 지난 사람" 같은 참인 문장이 들어왔고, `먼저` 는 "묻기 전에 먼저
    // 반영한다"는 뜻을 혼자 지지 못한다. 남은 셋이 그 뜻을 진다.
    for (const reversal of [
      /확인[^"]{0,14}(?:건너뛰|생략|안 해도|않아도|없이)/u,
      /승인[^"]{0,14}(?:건너뛰|생략|없이)/u,
      /(?:자동으로|알아서|묻지 않고)[^"]{0,10}(?:반영|변경|바꿔|수정)/u,
    ]) {
      expect(
        content,
        `확인 계약을 뒤집는 문장이 붙었다: ${String(reversal)}`,
      ).not.toMatch(reversal);
    }

    // 화면이 스스로 "아직 반영 전"이라고 말한다. 옛 데모는 상태 전환으로,
    // 새 카드는 정지된 그림으로 같은 것을 말한다.
    //
    // 2026-08-29: 카피 정본에서 "확인 버튼을 누르기 전까지 예산·할 일·일정에
    // 반영되지 않아요" 라는 **문장**이 없어졌다. 그 뜻은 두 자리로 쪼개져 살아 있다 —
    // 제안 라벨(`아직 반영 전`)과 카드 아래 한 줄. 둘 다 검사한다.
    expect(confirmCopy, "제안이 아직 저장 전이라고 말하지 않는다").toContain("저장 전");
    expect(confirmSection).toContain("{confirm.sample.contract}");

    // 예시라는 것도 말한다(옛 "기능 예시 · 이 화면에서는 실제로 저장되지 않아요").
    // 카피 정본이 두 줄로 이어 붙이므로 이어 붙인 문장으로 찾으면 못 찾는다 —
    // 조각으로 나눠 찾는다.
    expect(confirmCopy).toContain("기능을 설명하는 예시예요");
    expect(confirmCopy).toContain("이 화면에서는 저장할 수 없어요");
    // 옛 OneRoomSection 의 데모 고지가 지던 자리는 이제 아모라 카드다.
    // 그리고 그 카드는 고지를 **카드 안에서** 그린다(바깥 작은 글씨로 빼면 카드만
    // 캡처됐을 때 사실이 떨어져 나간다).
    expect(block("amoraNote")).toContain("기능을 설명하는 예시 대화예요");
    expect(amoraNoteSection).toContain("amoraNote.note");

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

    /**
     * ⚠️ **오늘 화면에 못 닿는 고지 — 지운 게 아니라 못으로 박아 둔 구멍이다.**
     *
     * 2026-08-29 실측: `confirm.sampleNote`("기능 예시예요. 이름·금액은 … 실제 이용
     * 현황이 아니에요.")를 **그리는 컴포넌트가 0개다.** `ConfirmSection` 은
     * `confirm.note` 까지만 그리고 sampleNote 를 건너뛴다. 즉 확인 데모 카드의
     * "3,000만 원" 옆에 샘플이라는 표시가 붙지 않는다.
     *
     * 카피를 고치는 것도 컴포넌트를 고치는 것도 이 테스트 파일의 일이 아니라서
     * 단언을 **없애는 대신 목록으로 고정한다.** 정확히 일치해야 하므로:
     *
     *   - ConfirmSection 이 sampleNote 를 그리기 시작하면 → 이 배열을 비워라(실패한다)
     *   - 다른 고지가 새로 화면에서 떨어지면            → 여기서 잡힌다(실패한다)
     *
     * 같은 뜻의 샘플 표시는 `amoraNote.note` 와 `confirm.sample.state` 이
     * 화면에서 지고 있다(위 "shows one concrete proposal" 케이스가 검사한다).
     */
    // 2026-08-29: `confirm.sampleNote` 가 여기 있었다. 이 검사가 "카피에만 있고 화면엔
    // 없다" 고 알려 줘서 `ConfirmSection` 이 카드 안에 그리도록 고쳤다.
    // 목록이 비었다 = 모든 고지가 화면에 닿는다.
    const KNOWN_UNRENDERED_NOTICES: readonly string[] = [];

    const unrendered = noticeMarkers.filter(
      (marker) => everyComponent.filter(([, text]) => text.includes(marker)).length === 0,
    );
    expect(
      unrendered,
      "화면에 닿지 않는 고지가 바뀌었다 — 고쳤으면 KNOWN_UNRENDERED_NOTICES 를 비우고, 새로 떨어졌으면 그 컴포넌트를 고쳐라",
    ).toEqual(KNOWN_UNRENDERED_NOTICES);

    for (const marker of noticeMarkers.filter(
      (candidate) => !KNOWN_UNRENDERED_NOTICES.includes(candidate),
    )) {
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

  it("leads with the first-visit outcome, keeps the pricing notice after the CTA, and ships no beta framing", () => {
    const heroCopy = block("hero");
    const confirmCopy = block("confirm");

    // 첫 문단은 "무엇이 문제고 우리가 무엇을 하는지"만 말한다.
    // 2026-09-03 시안: 문제는 "기록이 흩어진 것"에서 "둘의 답이 갈리는 것"으로 옮겼다.
    // 갈리는 것 셋을 먼저 이름으로 대고(예산·하객·부모님 의견) 그것부터 정한다고 말한다.
    expect(heroCopy).toMatch(/내가 원하는 결혼식부터 두 사람의 예산·일정·할 일까지/u);
    expect(heroCopy, "산출물을 개수로만 말하면 안 된다").not.toMatch(/(?:세|3|셋)\s*가지/u);

    // ## 베타는 개념 자체가 없어졌다 — 그래서 요구가 아니라 금지로 뒤집는다
    //
    // 2026-08-29 파운더 결정: "베타 우리 안할거야 알아둬". 옛 계약은 "계정 베타"라는
    // 경계 문구가 **CTA 뒤에 있어야 한다**였다(첫 화면에서 계정 이야기를 꺼내면
    // 로그인 없이 만져진다는 사실이 흐려지니까). 지금은 그 틀을 화면 어디에서도
    // 쓰지 않는다. 옛 단언을 지운 이유가 이것이다 — 문자열이 안 보여서가 아니라
    // 개념이 폐기돼서다.
    //
    // 카피 정본만 보면 주석에 남은 "베타" 가 대신 답할 수 있으니 **주석 벗긴 것**으로
    // 보고, 컴포넌트 전부까지 함께 센다.
    for (const retiredBetaFrame of ["계정 베타", "베타 신청", "사전등록", "승인 대기", "/beta"]) {
      expect(content, `랜딩 카피에 폐기된 베타 틀이 남았다: ${retiredBetaFrame}`).not.toContain(
        retiredBetaFrame,
      );
      for (const [file, text] of everyComponent) {
        expect(text, `${file}: 폐기된 베타 틀이 남았다: ${retiredBetaFrame}`).not.toContain(
          retiredBetaFrame,
        );
      }
    }
    expect(heroCopy).not.toContain("베타");
    expect(hero).not.toContain("베타");

    // **없어진 것은 틀이지 고지가 아니다.** "향후 이용 비용은 아직 정해지지 않았고,
    // 계정을 만들어도 지금은 결제를 요청하지 않아요" 는 베타라서가 아니라 오늘 참이라
    // 남는다(CLAUDE.md 2026-08-29). 그 고지가 지금 사는 자리가 확인 섹션이다.
    // 카피 정본이 두 줄로 이어 붙이므로 조각으로 찾는다.
    expect(confirmCopy).toContain("지금은 결제를 요청하지 않아요");
    expect(confirmCopy).toContain("향후 이용 비용은 아직 정해지지 않았고");
    expect(block("closing")).toContain("아모라와 예산·할 일·일정 관리에는 가입이 필요해요");

    // 히어로 안에서도 설명이 CTA 앞에 온다.
    //
    // `indexOf` 를 그냥 비교하면 안 된다 — 설명을 통째로 지우면 -1 이 되고
    // `-1 < 어떤 값` 이라 **문단이 사라진 쪽이 통과한다**. 존재부터 확인한다.
    const bodyAt = hero.indexOf("hero.body");
    const ctaAt = hero.indexOf("hero.primary.href");
    expect(bodyAt, "히어로가 hero.body 를 그리지 않는다").toBeGreaterThanOrEqual(0);
    expect(ctaAt, "히어로가 CTA 를 그리지 않는다").toBeGreaterThanOrEqual(0);
    expect(bodyAt).toBeLessThan(ctaAt);

    // 페이지 순서로도 계정 이야기가 CTA 뒤다. 확인 섹션이 히어로 앞으로 올라오면
    // 처음 온 사람이 계정 이야기부터 읽는다. 주석으로 꺼 놓은 섹션은 세지 않는다.
    expect(sectionIndex("ConfirmSection")).toBeGreaterThan(sectionIndex("TransformationHero"));
  });

  it("keeps entry links before the preview and decoration outside document flow", () => {
    const doc = heroDocument();
    const heading = doc.querySelector("h1");
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(heading?.textContent?.replace(/\s/gu, ""))
      .toBe(landingContent.hero.title.replace(/\s/gu, ""));
    const primary = doc.querySelector<HTMLAnchorElement>('a[href="/wedding/chat"]');
    const secondary = doc.querySelector<HTMLAnchorElement>('a[href="/wedding-code"]');
    const preview = doc.querySelector("figure");
    expect(preview).toBeTruthy();
    for (const link of [primary, secondary]) {
      expect(link).toBeTruthy();
      expect(link?.closest('[hidden],[aria-hidden="true"],.hidden,.sr-only')).toBeNull();
      expect(link?.className).toMatch(/focus-visible:(?:ring|outline)/u);
      expect((link?.compareDocumentPosition(preview!) ?? 0) & 4).toBe(4);
    }
    const decoration = new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(LandingBloomLayer)),
      "text/html",
    ).body.firstElementChild!;
    expect(decoration.classList.contains("absolute")).toBe(true);
    expect(decoration.classList.contains("pointer-events-none")).toBe(true);
    const svgs = [...decoration.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg.classList.contains("absolute")).toBe(true);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
    // SSR은 레이아웃 엔진이 아니다. 320px의 실제 CTA 위치·겹침은 브라우저 QA가 잰다.
  });



  it("renders named headings without reversing the approved visual hierarchy", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
    const h1 = doc.querySelector("h1")!;
    const headings = [...doc.querySelectorAll("main h2")];
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(headings.length).toBeGreaterThan(4);
    for (const viewport of [320, 390, 768, 1024, 1440]) {
      const heroSize = headingSizeAt(h1, viewport);
      expect(heroSize).toBeGreaterThanOrEqual(30);
      expect(heroSize).toBeLessThanOrEqual(50);
      for (const heading of headings) {
        expect(heading.textContent?.trim()).toBeTruthy();
        expect(heading.id).not.toBe("");
        expect(heading.closest("section")?.getAttribute("aria-labelledby")).toBe(heading.id);
        expect(heading.classList.contains("landing-display")).toBe(true);
        const size = headingSizeAt(heading, viewport);
        expect(size, heading.textContent ?? "").toBeGreaterThanOrEqual(
          heading.id === "preparation-record-title" ? 19 : 21,
        );
        expect(size, heading.textContent ?? "").toBeLessThanOrEqual(heroSize);
      }
    }
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

  it("keeps the mobile hero to one column and follows the original introduction order", () => {
    // 옛 히어로는 2단이었다 — 왼쪽 글, 오른쪽 결과 패널. 그래서 "작은 화면에서
    // 결과를 먼저"라는 계약이 min-h·grid-cols·max-w 값으로 고정돼 있었다.
    // 새 히어로는 어느 폭에서도 한 단이고, 결과(아모라가 적어 준 노트)는 컬럼이
    // 아니라 **바로 다음 섹션**이다. 지켜야 할 것은 같다: 첫 화면 다음에 곧바로
    // 증거가 온다.
    // ## 2026-09-03: "어느 폭에서도 한 단" → "**좁은 화면에서** 한 단"
    //
    // 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)이 히어로 오른쪽에 앱 화면
    // 미리보기를 되돌려 놨다. 그래서 넓은 화면은 다시 2단이다.
    //
    // 막으려던 해악은 폭이 아니라 **첫 행동이 아래로 밀리는 것**이었다("작은 화면에서
    // 결과를 먼저"). 그건 좁은 화면에서만 일어나므로, 계약을 거기에 맞춘다:
    // 본문을 감싼 조상은 **접두사 없는**(=모든 폭에 걸리는) 단 나누기를 쓸 수 없다.
    // `lg:grid-cols-…` 는 통과하고 `grid-cols-2` 는 잡힌다.
    //
    // 그리고 미리보기는 소스에서 본문 **뒤**에 온다 — 좁은 화면의 쌓이는 순서가 곧
    // 소스 순서라, 이것이 "첫 행동이 먼저"를 지키는 실제 장치다.
    expect(
      hero.indexOf("hero.note"),
      "미리보기가 첫 행동보다 앞에 온다 — 좁은 화면에서 CTA 가 밀린다",
    ).toBeLessThan(hero.indexOf("<AppPreviewCard"));

    // `grid` 하나만 막던 시절에는 `lg:flex lg:flex-row` 로 단을 나누면 통과했다.
    // 본문(H1·설명)을 감싼 **조상** 중 어느 것도 좁은 화면에서 단을 나누지 않아야 한다.
    // CTA 줄의 `sm:flex-row`(버튼 두 개를 옆으로)는 조상이 아니라서 여기 안 걸린다.
    const UNPREFIXED_COLUMNS = /(?:^|\s)(?:grid-cols-|flex-row|columns-)/u;
    for (const marker of ["hero.body", "<h1"]) {
      for (const tag of renderChain(hero, marker)) {
        expect(
          classNameOf(tag),
          `히어로 본문을 <${tag.name}> 이 좁은 화면에서도 여러 단으로 나눈다`,
        ).not.toMatch(UNPREFIXED_COLUMNS);
      }
    }
    // 자기검증: 접두사 없는 값은 잡고, 접두사 붙은 값은 통과시킨다.
    expect("mt-4 grid-cols-2 gap-3").toMatch(UNPREFIXED_COLUMNS);
    expect("grid items-center lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]")
      .not.toMatch(UNPREFIXED_COLUMNS);

    // 준비 결과와 확인 계약을 먼저 보여준 다음 대화와 의견 차이를 설명한다.
    // 주석으로 꺼 놓은 섹션은 세지 않고 실제 JSX 순서를 검사한다.
    const heroAt = sectionIndex("TransformationHero");
    expect(sectionIndex("AmoraNoteSection")).toBeGreaterThan(heroAt);
    expect(
      renderedSectionNames.slice(heroAt + 1, heroAt + 5),
      "확인 경계를 먼저 보여준 다음 대화와 두 사람의 의견 차이를 설명한다",
    ).toEqual(["AmoraNoteSection", "NoSideSection", "ConfirmSection", "AvailableNowSection"]);
  });

  it("shows the shared-record evidence on mobile", () => {
    // 이전 계약은 대화 컬럼을 `hidden ... md:block`으로 숨겨 히어로를 짧게 유지했다.
    // 그런데 H1이 "둘이 말하면"이라 두 사람이 말하는 장면이 모바일에서 사라지면
    // 첫 화면의 약속과 증거가 어긋난다. H1이 "결혼 준비 노트, **같이** 정리해요"로
    // 바뀐 지금도 약속은 같다 — 두 사람이 나오는 장면이 모바일에 보여야 한다.
    //
    // 그 장면을 지는 컴포넌트가 옮겨 갔다: `ScenesSection`·`OneRoomSection` 이
    // 없어지고, 이제 `ConfirmSection` 의 "둘이 말한 것" 카드가 그 일을 한다.
    // 로그인 없이 열리는 카드들(`AvailableNowSection`)도 같은 규칙을 받는다 —
    // 옛 ScenesSection 이 지던 스무 장면이 그리로 내려갔기 때문이다.
    //
    // 옛 검사는 `className="[^"]*(?:^|\s)(?:[a-z]+:)?hidden(?:\s|$)[^"]*"` 였다.
    // `^` 가 문자열 시작이라 className **맨 앞**의 hidden 을 못 봤고, 템플릿 리터럴
    // className 은 아예 안 봤다. 그래서 `className="hidden lg:block"` 으로 이 장면을
    // 모바일에서 감춰도 통과했다 — 그 주석이 경고한 바로 그 회귀가 초록불이었다.
    for (const [file, text] of [
      ["ConfirmSection.tsx", confirmSection] as const,
      ["AvailableNowSection.tsx", availableNowSection] as const,
    ]) {
      for (const value of classValues(text)) {
        expect(value, `${file}: 두 사람 장면을 폭으로 감추지 않는다`).not.toMatch(HIDING_UTILITY);
      }
    }

    // 장면 자체는 두 사람이 나오고, 한 사람이 확인하면 **상대에게 알림이 간다**는
    // 것까지 말해야 한다. 이름(민지·현우)이 역할(신부·신랑)로, 다시 "둘이 말한 것"
    // 카드로 바뀐 것은 개편이고, "두 사람이 같이 쓰는 기록"이라는 계약은 그대로다.
    const confirmCopy = block("confirm");
    for (const line of [
      "파트너와 연결한 뒤에는 두 사람 중 한 명이 저장하면 공동 기록에 반영돼요",
      "파트너도 앱에서 변경 알림을 볼 수 있어요",
    ]) {
      expect(confirmCopy, `두 사람 장면에서 ${line}이 빠졌다`).toContain(line);
    }
    // 2026-09-03: 카드가 "둘이 말한 것 한 줄 + 제안 한 건" 에서 "이해한 것 세 줄" 로
    // 바뀌었다. 두 사람이 말한 것에서 나왔다는 표시는 `saidLabel` 이 잇는다.
    expectVisible("ConfirmSection.tsx", confirmSection, "confirm.sample.saidLabel");
    expectVisible("ConfirmSection.tsx", confirmSection, "confirm.body2");

    // 첫 화면 바로 다음 증거는 아모라가 실제로 답하는 모습 그대로다.
    // 카피에 있는 것만으로는 부족하다 — 그리는 자리도 함께 본다.
    //
    // **문장을 옮겨 적지 않는다.** 여기 적었던 문장은 라이브 문항이 아니라
    // 지어낸 것이었고, 그래서 랜딩이 틀린 견본을 보여 주는데도 통과했다.
    // 그래서 문장이 아니라 **모양**만 본다(질문 한 줄 · 동그라미 쳐지는 답 한 조각).
    //
    // 2026-09-03 시안으로 그 장면이 **노트 한 장에서 대화 카드**로 바뀌었다. 모양만
    // 보는 것은 그대로다 — 사람이 한 말 한 줄과 아모라가 답한 한 줄.
    const amoraCopy = block("amoraNote");
    expect(amoraCopy).toMatch(/me:\s*"[^"]{10,}"/u);
    expect(amoraCopy).toMatch(/amora:\s*"[^"]{10,}"/u);
    for (const marker of ["amoraNote.chat.me", "amoraNote.chat.amora"]) {
      expect(amoraNoteSection).toContain(marker);
      expectVisible("AmoraNoteSection.tsx", amoraNoteSection, marker);
    }
  });

  it("구체적인 기록 목적지를 말할 때 승인 경계가 같은 문장에 있다", () => {
    const doc = heroDocument();
    const outcome = doc.querySelector("#hero-title + p")?.textContent ?? "";
    expect(toolNamesIn(outcome)).toEqual(["예산", "할 일", "일정"]);
    expect(outcome).toMatch(/예산·일정·할 일[\s\S]*직접 확인해 기록/u);
    const budgetExample = landingContent.hero.preview.scenes.find((scene) => scene.id === "budget");
    expect(budgetExample?.proposalStatus).toBe("저장 전");
    expect(budgetExample?.proposalNote).toContain("직접 확인하고 저장해야 예산에 반영돼요");
    expect(outcome).not.toMatch(/자동으로|알아서 저장|확인 없이/u);
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
