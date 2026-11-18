// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";

import LandingPage from "../page";
import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
} from "./landingSource";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

/**
 * 랜딩이 양쪽(처음 온 사람 · 업체)에게 하는 약속과 그 근거를 지킨다.
 *
 * ## 2026-08-28 적대적 검증의 교훈 — 지금도 이 파일의 뼈대다
 *
 * 1. **주석이 코드 대신 대답했다** → `landingSource` 의 `rendered`/`contentBlock` 만 쓴다.
 * 2. **자리를 안 봤다** → 있어야 할 블록에서 찾는다(`contentBlock`).
 * 3. **덧붙임을 못 막았다** — 계약 문장 뒤에 뒤집는 문장을 붙이면 전부 초록이었다
 *    ("급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요") → `FORBIDDEN` 배터리.
 * 4. **정규식이 좁았다** — "406개" · "가입하지 **않**아도" · "이미 1만 쌍이…" 가 통과했다
 *    → 어형·표기·단위를 함께 받는 패턴.
 * 5. **렌더가 아니라 카피만 봤다** → 그 값을 화면이 실제로 쓰는지까지 본다.
 *
 * ## 2026-11-17 — 시작 화면
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩은 시작 화면 한 장과
 * 조용한 바닥글이 됐다. 첫 화면 글자는 앱과 같은 정본 `START_COPY` 에서 오므로 **그 글자와
 * 렌더된 페이지 전체**도 같은 자로 잰다 — 랜딩 소스 파일만 재면 첫 화면이 검사를 안 거친다.
 * 섹션·내비·마무리를 지키던 단언(이야기 순서·내비 앵커·첫 화면과 마무리의 같은 행동)은
 * 대상이 없어져 지웠다. 근거(출처·기준 시점·한계·광고 없음)는 바닥글이 진다.
 */

const components = everyLandingComponent();
const content = rendered(CONTENT_PATH);
const footer = rendered("src/components/landing/redesign/LandingFooter.tsx");
const startScreen = rendered("src/components/landing/redesign/StartScreen.tsx");

function landingText(): string {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
  return doc.body.textContent ?? "";
}

/** 랜딩이 사용자에게 내보내는 글 전부 — 소스(주석 벗김)·시작 화면 정본·렌더 결과. */
const renderedCopy = [
  rendered("src/app/landing/page.tsx"),
  content,
  ...components.map(([, src]) => src),
  Object.values(START_COPY).flat().join("\n"),
  landingText(),
].join("\n");

/**
 * 있으면 안 되는 문장들. 각 패턴은 **현재 카피에서 오탐이 0인 것을 확인하고** 넣었다.
 * 계약 문장 자체가 같은 낱말을 쓰는 자리("업체에 점수·등급·순위를 매기지 않아요")는 서술형
 * 어미까지 붙여 긍정 진술만 걸리게 했다.
 */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  // 제품 계약: 아모라는 사용자 확인 없이 아무것도 바꾸지 않는다.
  [
    /(?:확인|승인)[^.\n]{0,10}(?:없이|건너뛰|생략|안\s?하고|하지\s?않고|안\s?해도|하지\s?않아도)[^.\n]{0,24}(?:반영|저장|적용|변경|바꿔|바꾸|고쳐|입력)/u,
    "확인 없이 반영한다고 말한다 — 제품 계약을 정면으로 뒤집는다",
  ],
  [/(?:반영|저장|적용)[^.\n]{0,16}(?:뒤|후|나중)[^.\n]{0,12}(?:확인|승인)/u, "먼저 반영하고 나중에 확인한다고 말한다"],
  [
    /(?:자동으로|알아서|스스로)[^.\n]{0,16}(?:반영|저장|적용|바꿔|바꾸|변경|정리해|추가해|삭제)/u,
    "사용자 확인 없이 자동으로 바꾼다고 말한다",
  ],
  [
    /아모라(?:가|는|도)?[^.\n]{0,12}(?:대신|알아서)[^.\n]{0,12}(?:정해|결정|골라|선택|판단)/u,
    "아모라가 대신 결정한다고 말한다 — 한쪽 손을 들지 않는다는 계약과 어긋난다",
  ],

  // 업체에서 돈을 받지 않는다(업체 제휴 0건이라 지킬 수 있는 문장이다).
  [
    /(?:광고비|소개비|수수료|제휴비|입점비)[^.\n]{0,16}(?:받아요|받습니다|받고\s?있|받으면|받는\s?대신|받아서)/u,
    "업체 돈을 받는다고 말한다",
  ],
  [/(?:점수|등급|순위|별점|평점)(?:를|을)?\s*(?:매겨|매깁니다|매겨요|드려요|제공해)/u, "업체·상품에 점수·등급·순위를 매긴다고 말한다"],
  [/(?:최저가|최저\s*가격)/u, "최저가를 말한다 — 우리는 가격 적정성을 판정하지 않는다"],
  [
    /(?:예약|계약)(?:을|를)?\s*(?:대신\s*)?(?:잡아|잡아드려|해\s?드려요|진행해\s?드려요)/u,
    "예약·계약을 대신 해준다고 말한다 — 거래층은 보류 중이다",
  ],
  [/계약서[^.\n]{0,12}(?:해석해|분석해|검토해)\s*(?:드려요|드립니다|줘요|드릴게요)/u, "계약서를 대신 해석해 준다고 말한다"],
  [
    /(?:법률|의료|금융)[^.\n]{0,10}(?:판단|상담)(?:해|을|를)?\s*(?:드려요|드립니다|해\s?드려요)/u,
    "법률·의료·금융 판단을 한다고 말한다",
  ],

  // 비용 경계. "향후 요금은 아직 정해지지 않았다" 가 정본이다.
  [
    /(?:서비스|웨딩한방|모든\s*기능|전\s*기능|전부|평생|계속)[^.\n]{0,8}(?:무료|공짜)/u,
    "서비스가 통째로 무료라고 말한다 — 비용은 아직 정해지지 않았다",
  ],
  [/((?:항상|평생|영구|무제한)[^.\n]{0,6}(?:무료|공짜)|(?:무료|공짜)[^.\n]{0,6}(?:항상|평생|영구|무제한))/u, "영구·무제한 무료라고 단정한다"],

  // 없는 사회적 증거. 랜딩은 이용자 수를 말할 근거가 없다.
  [/\d[\d,]*\s*(?:만\s*)?(?:쌍|커플|가정|부부|가입자|이용자)/u, "이용자 수를 숫자로 말한다 — 근거가 없다"],
  [
    /(?:이용자|가입자|사용자|예비부부|커플)[^.\n]{0,12}\d[\d,]*\s*(?:만\s*)?명|\d[\d,]*\s*(?:만\s*)?명(?:의)?\s*(?:이용자|가입자|사용자|예비부부|커플)/u,
    "두 어순의 이용자 수를 명 단위로 말한다 — 근거가 없다",
  ],
  [
    /(?:이미|벌써|현재|지금까지)[^.\n]{0,12}(?:\d[\d,]*|수많은|많은|여러|수천|수만)[^.\n]{0,8}(?:쌍|명|커플|부부|사람|팀)/u,
    "이미 많은 사람이 쓰고 있다고 말한다",
  ],
  [/(?:평점|별점|만족도)/u, "평점·별점·만족도를 말한다"],
  [
    /\d[\d,]*\s*(?:%|퍼센트|만원|원|시간|분)[^.\n]{0,12}(?:절약|절감|아꼈|아껴|줄였|줄여|아낄)/u,
    "절약·절감 수치를 말한다",
  ],

  // 가격 출처는 한국소비자원 하나뿐이다(업체 제휴 0건).
  [
    /(?:제휴사|협력사|파트너사|자체\s*조사)[^.\n]{0,12}(?:가격|최저|기본가|요금|시세)/u,
    "한국소비자원 말고 다른 가격 출처가 있다고 말한다",
  ],

  // 장기기억은 오늘 켤 수 없다. 이어지는 것은 대화 기록이지 모델의 기억이 아니다.
  [/기억/u, "랜딩이 기억을 약속한다 — 기억 엔진은 오늘 켤 수 없다"],

  // 2026-08-29 파운더 결정: 베타를 하지 않는다.
  [
    /베타|사전\s*등록|사전등록|승인\s*(?:을\s*)?(?:기다|대기)/u,
    "베타·사전등록·승인 대기 틀이 화면에 돌아왔다 — 2026-08-29 파운더 결정으로 없앴다",
  ],
];

/**
 * 근거 없는 업체 수. 자리 단위(곳·군데·개사)는 그 자체로 업체 수이므로 바로 잡고,
 * 흔한 단위(개·건·사)는 업체를 가리키는 낱말이 앞뒤에 붙을 때만 잡는다.
 */
const VENDOR_COUNT =
  /\d[\d,]*\s*(?:곳|군데|개사|개소)|(?:업체|업소|예식장|웨딩홀|스튜디오|매장|제휴사)[^.\n]{0,14}\d[\d,]*\s*(?:개|건|사|팀)|\d[\d,]*\s*(?:개|건|사|팀)[^.\n]{0,14}(?:업체|업소|예식장|웨딩홀|스튜디오|매장|제휴사)/gu;

describe("없는 이용자 수 사회적 증거 검사", () => {
  it.each([
    "이용자 1,000명이 사용해요",
    "1,000명의 이용자가 사용해요",
    "가입자 2만 명이 함께해요",
    "2만 명의 가입자가 함께해요",
    "사용자 500명이 준비하고 있어요",
    "500 명의 사용자가 준비하고 있어요",
    "예비부부 700명이 이용해요",
    "700명의 예비부부가 이용해요",
  ])("이용자 수 주장 두 어순을 모두 거부한다: %s", (claim) => {
    expect(FORBIDDEN.some(([pattern]) => pattern.test(claim)), claim).toBe(true);
  });

  it.each([
    "내년 가을쯤 결혼하고 싶어. 하객은 100명 정도야. 뭐부터 해야 해?",
    "하객 1,000명이 올 수 있는 식장을 찾고 싶어요",
    "하객 100명 기준으로 확인할 항목을 정리해 주세요",
  ])("개인이 말한 하객 수를 이용자 수 주장으로 오인하지 않는다: %s", (example) => {
    expect(FORBIDDEN.some(([pattern]) => pattern.test(example)), example).toBe(false);
  });
});

describe("landing two-sided trust contract", () => {
  it("reads every surface it claims to read", () => {
    // 표면이 비면 아래 금지 검사가 전부 빈 통과가 된다.
    expect(renderedCopy).toContain(START_COPY.body);
    expect(renderedCopy).toContain("아모라의 답변은 AI가 작성해요");
    expect(renderedCopy.length).toBeGreaterThan(4000);
  });

  it("never states a vendor count without its source and as-of date", () => {
    // 랜딩은 406·829·831 중 어느 것도 쓰지 않는다(`countLabelsSayWhatTheyCount.test.ts`).
    // 수를 다시 쓰기로 하면 그 문자열을 명시적으로 허용하고 라벨 규칙에도 함께 등재하라.
    expect(renderedCopy, "근거 없는 업체 수가 랜딩에 돌아왔다").not.toMatch(VENDOR_COUNT);
    // 수치를 통째로 지우면 위 대조는 조용히 통과한다 — 출처의 기준 시점을 못 박는다.
    expect(contentBlock("footer")).toContain("2025년 11월 공시 기준");
  });

  it("keeps each call to action aligned with its destination", () => {
    // 첫 화면의 두 행동은 정본 글자와 실재하는 목적지를 쓴다. 손으로 적은 목적지(`href="#"`)는
    // 아래 단언을 다 통과하면서 아무 데도 안 간다.
    const start = contentBlock("start", "account");
    const hrefs = [...start.matchAll(/href: "([^"]+)"/gu)].map((m) => m[1]);
    expect(hrefs).toEqual(["/wedding/chat", "/example"]);
    for (const href of hrefs) expect(href).toMatch(/^\/[a-z0-9-]/u);
    expect(startScreen).toContain("href={start.primary.href}");
    expect(startScreen).toContain("{START_COPY.start}");
    expect(startScreen).toContain("href={start.example.href}");
    expect(startScreen).toContain("{START_COPY.example}");
    expect(startScreen, "시작 화면이 목적지를 손으로 적었다").not.toMatch(/href="/u);
  });

  it("keeps the disclosure source, paid-ranking promise, and limits visible", () => {
    const boundariesCopy = contentBlock("boundaries", "notices");
    const footerCopy = contentBlock("footer");

    // 출처 — 우리가 옮겨 적었을 뿐이라는 것.
    expect(footerCopy).toContain("가격 출처: 한국소비자원 참가격");
    // 광고 상품이 없다. 광고 상품을 시작하면 **표시 약속을 다시 적어야 한다.**
    expect(boundariesCopy).toContain("광고 상품은 운영하지 않아요.");
    expect(boundariesCopy).toContain("공시 가격과 규정은 요약하지 않고 원문으로 제공해요.");
    // 한계. 공시가는 기본 조건 기준이고, 공시한 업체만 실려 지역 편차가 크다.
    expect(footerCopy).toContain("공시 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있어요");
    expect(footerCopy).toContain("가격을 공시한 업체만 제공하므로");
    expect(footerCopy).toContain("지역별 등록 업체 수가 달라요");
    // 출처는 한국소비자원 하나뿐이다 — 제휴사 가격표는 없다.
    expect(content).not.toContain("제휴사별 최저 기본가");

    // 바닥글이 그 값들을 실제로 그린다.
    for (const wiring of [
      "boundaries.items.map(",
      "{item.title}",
      "{item.note}",
      "href={boundaries.policyLink.href}",
      "{boundaries.policyLink.label}",
      "{footer.notice}",
    ]) {
      expect(footer, `바닥글이 ${wiring} 을 안 쓴다`).toContain(wiring);
    }
    expect(boundariesCopy).toContain('href: "/ai-policy"');

    // 원문 링크가 가리키는 공시 게시판. 이 상수가 주석 안에 있으면 죽은 코드다.
    expect(rendered("src/lib/price/period.ts")).toContain("boardTypeCode=0090000122");
  });

  it("does not invent social proof, savings, or pricing claims", () => {
    for (const unsupportedClaim of [
      "누적 이용자", "만 명이 선택", "시간 절약", "비용 절감", "최저가 보장", "모든 기능 무료", "실제 이용 후기",
    ]) {
      expect(renderedCopy).not.toContain(unsupportedClaim);
    }
    // 랜딩에서 "후기" 는 우리 제품에 대한 사회적 증거로 읽힌다.
    for (const word of ["후기", "만족도", "성공률", "1위", "최고", "보장", "절감"]) {
      expect(renderedCopy, `검증되지 않은 주장 "${word}"`).not.toContain(word);
    }
  });

  it("never says the opposite of what it promises", () => {
    for (const [pattern, why] of FORBIDDEN) {
      const hit = renderedCopy.match(pattern);
      expect(hit?.[0], `${why} — 걸린 문장: ${hit?.[0] ?? ""}`).toBeUndefined();
    }
  });

  it("never promises Amora without a login", () => {
    // 한도 정책이 확정되기 전까지 "가입 없이 아모라를 쓸 수 있다"고 말하지 않는다. 비로그인
    // 아모라 체험은 #245 로 닫혔다. 부정 어형을 넓게 받고, 낱말 순서가 뒤집힌 표기도 받는다.
    const negation = "(?:없|않|안(?!내)|말고|불필요)";
    const gate = "(?:로그인|가입|계정|회원)";
    const amora = "(?:아모라|체험|상담|대화)";
    const noLoginAmora = new RegExp(
      `${gate}[^.\\n]{0,14}${negation}[^.\\n]{0,24}${amora}|${amora}[^.\\n]{0,24}${gate}[^.\\n]{0,14}${negation}`,
      "u",
    );
    // 자기검증: 패턴이 실제 위반을 잡고, 오늘의 정상 문장은 통과시킨다.
    expect("가입하지 않아도 아모라와 이야기해요").toMatch(noLoginAmora);
    expect("아모라를 계정 없이 써 보세요").toMatch(noLoginAmora);
    expect("아모라와 예산·할 일·일정 관리에는 가입이 필요해요.").not.toMatch(noLoginAmora);

    const hit = renderedCopy.match(noLoginAmora);
    expect(hit?.[0], `랜딩이 로그인 없는 아모라·체험을 약속한다: ${hit?.[0] ?? ""}`).toBeUndefined();
    // 숫자를 추측해 적지 않는다 — 한도 값이 아직 정해지지 않았다.
    expect(renderedCopy).not.toMatch(/무료\s*\d[\d,]*\s*(?:회|번|건|턴|개|일|개월|명|질문|메시지)/u);
    expect(renderedCopy).not.toMatch(/\d[\d,]*\s*(?:회|번|건|턴|개월)\s*(?:까지\s*)?무료/u);
  });

  it("states the current first-step conditions without claiming the whole service is free", () => {
    // 누르기 전에 조건을 안다 — 무엇이 가입 없이 열리고, 지금은 결제를 요청하지 않는다.
    const notices = contentBlock("notices", "footer");
    expect(notices).toContain("무료 도구는 가입 없이 이용할 수 있어요");
    expect(notices).toContain("아모라와 예산·할 일·일정 관리에는 가입이 필요해요");
    expect(notices).toContain("현재 무료로 이용할 수 있어요");
    expect(notices).toContain("향후 요금은 아직 정해지지 않았어요");
    for (const wiring of ["{notices.signup}", "{notices.pricing}"]) {
      expect(footer, `바닥글이 ${wiring} 을 안 쓴다`).toContain(wiring);
    }
    // 가입 없이 열리는 도구가 실제 목적지로 간다.
    const open = contentBlock("footer");
    for (const href of ["/price", "/wedding/community/quote-check", "/wedding-code", "/wedding/manners"]) {
      expect(open, `가입 없이 이용 묶음에 ${href} 가 없다`).toContain(`href: "${href}"`);
    }
  });
});
