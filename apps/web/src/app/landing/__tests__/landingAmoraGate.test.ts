import { describe, expect, it } from "vitest";

import { everyLandingComponent, rendered, CONTENT_PATH } from "./landingSource";

/**
 * 랜딩이 로그인 없는 아모라를 약속하지 않는다.
 *
 * ## 왜 이 파일이 따로 있나
 *
 * 비로그인 아모라 체험은 **#245 로 닫혔다**(기본 꺼짐). 그런데 랜딩 카피가 그걸
 * 약속하면 사용자는 없는 기능을 기대하고 들어와 벽을 만난다.
 *
 * 2026-08-27 에 실제로 그런 문장이 제품 카피에 들어갔다 —
 * `hero.note` 가 "가입하지 않아도 아모라와 이야기할 수 있어요" 로 바뀐 채 남았고,
 * 타입체크·린트·카피 대조가 **전부 초록**이었다. 화면을 눈으로 보다가 찾았다.
 *
 * ## 왜 금지 정규식이 아니라 허용목록인가
 *
 * 그때 이걸 지키던 가드는 부정어 목록(`없|않|안|말고|불필요`)을 쓰는 금지 정규식이었다.
 * 적대적 검증에서 **여섯 가지 표현이 그대로 빠져나갔다**:
 *
 *   "회원가입 **전에도** 아모라를 써볼 수 있어요"      ← 부정어가 없다
 *   "로그인 **전에** 아모라를 먼저 만나보세요"          ← 부정어가 없다
 *   "**누구나** 지금 아모라와 이야기할 수 있어요"        ← 관문 낱말조차 없다
 *
 * 한국어로 같은 뜻을 쓰는 방법은 끝이 없다. 금지 목록은 항상 진다.
 *
 * 그래서 **뒤집는다.** 아모라와 관문 낱말이 한 문장에 같이 나오면 일단 실패시키고,
 * 사람이 검토한 문장만 아래 목록에 올린다. 새 문장을 쓰려면 이 파일을 고쳐야 하고,
 * 고치는 순간 리뷰어가 그 문장을 본다.
 *
 * **도입 시점 실측: 해당 문장 0개.** 목록이 비어 있는 것은 실수가 아니다.
 */

/** 아모라를 가리키는 말. */
const AMORA = /아모라/u;

/** 계정 관문을 가리키는 말. */
const GATE = /로그인|가입|계정|회원/u;

/**
 * 사람이 검토해 허용한 문장.
 *
 * 여기 올리기 전에 확인할 것:
 * 1. `AMORA_ANONYMOUS_CHAT_ENABLED` 계열 플래그가 프로덕션에서 켜져 있는가?
 *    (2026-08-27 기준 **아니오** — #245 로 기본 꺼짐)
 * 2. 그 문장이 약속하는 것을 오늘 사용자가 직접 재현할 수 있는가?
 *
 * "아모라와 대화하려면 로그인이 필요해요" 처럼 **관문이 있다고 말하는** 문장은
 * 여기 올려도 된다. 관문이 **없다고** 말하는 문장은 올리면 안 된다.
 */
const APPROVED: readonly string[] = [
  // /wedding/chat은 로그인과 시작 설정을 거쳐 돌아오는 보호 경로다.
  // CTA와 고지·내비가 이어 붙은 런까지 검토하며 비로그인 체험은 허용하지 않는다.
  "아모라와 준비 시작하기 웨딩코드로 내 생각 살펴보기 아모라는 로그인과 시작 설정 후 이용해요.",
  "준비 공간 열기 아모라에게 지금 고민 말하기 필요한 제안만 확인해 저장하기 무료 도구는 가입 없이 이용할 수 있어요.",
  "아모라와 예산·할 일·일정 관리에는 가입이 필요해요.",
  "가입 없이 이용 공시 가격·위약금 견적 질문 만들기 웨딩코드 결혼 예절 가이드 가입 후 이용 아모라 결정 보드 예산 체크리스트 일정 정책·문의 이용약관 개인정보처리방침 서비스 정책 가격 출처 한국소비자원 참가격, 2025년 11월 공시 기준.",
  "아모라 둘의 우선순위 준비 관리 먼저 써보기 자주 묻는 질문 아모라 시작하기 로그인",
];
/** 문장 단위로 자른다. 한국어 종결부호 기준. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 소스에서 화면에 나갈 수 있는 한국어를 전부 뽑는다(주석 제거 뒤).
 *
 * 처음에는 **겹따옴표 문자열만** 읽었다. 그래서 같은 약속을 이렇게 쓰면 통과했다:
 *
 *   `<p>가입 없이 아모라를 지금 써 볼 수 있어요.</p>`   ← JSX 본문
 *   `label: '가입 없이 아모라'`                          ← 홑따옴표
 *   `` `아모라를 ${무엇} 없이` ``                        ← 템플릿 리터럴
 *
 * 화면에 나가는 것은 문자열 리터럴만이 아니다. 그래서 **한글이 이어지는 덩어리**를
 * 전부 후보로 본다 — 코드 식별자에는 한글이 없어 오탐이 거의 없고, 어떻게 적든 잡힌다.
 */
function screenStrings(source: string): string {
  // 한글로 시작해 한글·공백·문장부호가 이어지는 구간. 태그와 코드 기호에서 끊긴다.
  const KOREAN_RUN = /[가-힣][가-힣0-9\s.,!?“”‘’'·…%~()\-]*/gu;
  return (source.match(KOREAN_RUN) ?? []).join(" ");
}

describe("랜딩은 로그인 없는 아모라를 약속하지 않는다", () => {
  it("아모라와 계정 관문이 한 문장에 같이 나오지 않는다", () => {
    const surfaces: Array<[string, string]> = [
      [CONTENT_PATH, rendered(CONTENT_PATH)],
      ...everyLandingComponent().map(
        ([file, source]) => [file, source] as [string, string],
      ),
    ];

    const found: string[] = [];
    for (const [file, source] of surfaces) {
      for (const sentence of sentences(screenStrings(source))) {
        if (!AMORA.test(sentence) || !GATE.test(sentence)) continue;
        if (APPROVED.includes(sentence)) continue;
        found.push(`${file}: ${sentence}`);
      }
    }

    expect(
      found,
      "아모라와 계정 관문이 같이 나오는 검토되지 않은 문장입니다. "
        + "관문이 **없다**고 말하는 문장이면 지우고, "
        + `관문이 **있다**고 말하는 문장이면 이 파일의 APPROVED 에 올리세요. ${JSON.stringify(found)}`,
    ).toEqual([]);
  });

  it("아모라를 '지금 쓸 수 있다'고 말하지 않는다", () => {
    // 허용목록 축은 **관문 낱말이 있는** 문장만 본다. 관문을 아예 언급하지 않고
    // "누구나 지금 아모라와 이야기할 수 있어요" 라고 쓰면 그 축에 안 걸리는데,
    // 읽는 사람에게는 같은 약속이다(적대적 검증에서 실제로 빠져나갔다).
    //
    // 그래서 축을 하나 더 둔다: **아모라 + 즉시성 + 가능**이 한 문장에 모이면 실패.
    // 아모라를 설명하는 문장은 많지만 "지금 바로 쓸 수 있다"고 말할 이유는 없다 —
    // 오늘 그건 사실이 아니다(#245).
    // '지금 상황을 말해 보세요'는 가입 CTA 뒤에서 실제 사용 순서를 설명한다.
    // 비가입 즉시 체험을 약속하는 시간 표현만 잡는다.
    const NOW = /누구나|당장|지금 바로|바로 지금/u;
    const CAN = /대화할 수 있|이야기할 수 있|써 볼 수 있|써볼 수 있|체험할 수 있|만나볼 수 있/u;

    const offenders: string[] = [];
    const surfaces: Array<[string, string]> = [
      [CONTENT_PATH, rendered(CONTENT_PATH)],
      ...everyLandingComponent().map(
        ([file, source]) => [file, source] as [string, string],
      ),
    ];
    for (const [file, source] of surfaces) {
      for (const sentence of sentences(screenStrings(source))) {
        if (!AMORA.test(sentence)) continue;
        if (!NOW.test(sentence) || !CAN.test(sentence)) continue;
        if (APPROVED.includes(sentence)) continue;
        offenders.push(`${file}: ${sentence}`);
      }
    }
    expect(
      offenders,
      "아모라를 지금 쓸 수 있다고 말하는 문장입니다. #245 로 비로그인 체험은 꺼져 있습니다.",
    ).toEqual([]);
  });

  it("허용목록에 올린 문장이 실제로 카피에 있다", () => {
    // 없어진 문장이 목록에 남으면, 그 자리가 비어 있는데도 "검토됐다"로 읽힌다.
    const all = [
      screenStrings(rendered(CONTENT_PATH)),
      ...everyLandingComponent().map(([, source]) => screenStrings(source)),
    ].join(" ");
    const stale = APPROVED.filter((s) => !all.includes(s));
    expect(stale, `카피에 없는 문장이 허용목록에 남아 있습니다: ${JSON.stringify(stale)}`).toEqual([]);
  });

  it("아모라를 소개하는 자리에는 AI 고지가 붙는다", () => {
    // AI 기본법 — 사람인 것처럼 소개하지 않는다. 위 검사가 관문 문장을 막는 동안
    // 아모라 자체를 소개하는 문장이 사라지면 안 되므로 함께 고정한다.
    const content = rendered(CONTENT_PATH);
    expect(content).toContain("아모라 · AI 생성");
    expect(content).toContain("AI 답변에는 오류가 있을 수 있어요");
  });
});
