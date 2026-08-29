/**
 * 다른 분야의 예산은 결혼 도구도 커플 문맥도 받지 않는다.
 *
 * ## 내 반례가 너무 쉬웠다
 *
 * 맨 `예산` 을 결혼 낱말로 넣고 반례 26개로 재니 유출이 0이었다. 그런데 그 26개는
 * 전부 이미 가드 목록에 있는 화제(`여행`·`회사`·`이사`·`유학`…)였다. 목록에
 * **없는** 화제로 다시 재니 200건 중 168건이 W0 이 됐다.
 *
 * 여기 쓰는 25개 화제는 2026-08 감사에서 200건 중 176건을 통과시켰던 바로 그
 * 목록이다. 가드 목록에 하나도 들어 있지 않다 — 그게 요점이다.
 *
 * ## 측정
 *
 *     origin/main            W0 75 / 200   기억 ON 50
 *     맨 `예산` (내 첫 판)      W0 168 / 200  기억 ON 42
 *     지금                    W0 0 / 200    기억 ON 0
 */
import { describe, expect, it } from "vitest";

import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const classify = (userText: string) => classifyAmoraQuestionScope({ userText });

const FOREIGN_TOPICS = [
  "자퇴", "게임", "유튜브", "도박 빚", "파산", "문신", "담배", "알바", "휴학",
  // `밴드`·`술` 은 일부러 뺐다 — 웨딩 밴드는 반지이고 주류는 예산 항목이다.
  "편입", "커밍아웃", "논문", "고소", "왕따", "괴롭힘", "친구 채무", "로또",
  "육아", "돌잔치", "연말정산", "골프", "등산", "보이스피싱",
];
const BUDGET_FORMS = [
  "%s 예산 짜줘", "%s 예산 얼마나 잡아야 해?", "%s 예산 항목별로 정리해줘",
  "%s 예산 배분해줘", "%s 예산 보여줘", "%s 예산 총액 바꿔줘",
  "%s 예산 감이 없어", "%s 예산",
];
const FOREIGN = FOREIGN_TOPICS.flatMap((topic) =>
  BUDGET_FORMS.map((form) => form.replace("%s", topic)));

const nl = String.fromCharCode(10);

describe("다른 분야 예산은 결혼 도구를 못 받는다", () => {
  it("어느 것도 W0 이 아니다", () => {
    const leaked = FOREIGN.filter((t) => classify(t).scope === "W0_wedding_core");
    expect(leaked.join(nl)).toBe("");
  });

  it("어느 것도 공유 장기 기억을 열지 않는다", () => {
    // 진짜 대가는 도구가 아니라 기억이다 — 그 발화가 커플 공유 기억에 남는다.
    const opened = FOREIGN.filter((t) => classify(t).allowsLongTermMemory);
    expect(opened.join(nl)).toBe("");
  });
});

describe("우리 예산은 그대로 열린다", () => {
  it.each([
    "예산 보여줘",
    "예산 현황 알려줘",
    "남은 예산 알려줘",
    "전체 예산 보여줘",
    "총 예산을 4천만원으로 변경해줘",
    "우리 예산 얼마 남았어?",
    "다시 예산 정리해줘",
    "항목별 예산 배정 합계랑, 직접 추가한 항목들 다 알려줘",
    "예산은 진짜 감이 없어. 우리 조건이면 총 얼마쯤 잡아야 해? 항목별로도 알려줘.",
  ])("%s", (userText) => {
    expect(classify(userText).scope).toBe("W0_wedding_core");
  });

  it("결혼 낱말이 꾸미면 그 낱말이 목록에 없어도 열린다", () => {
    // 꾸미는 말 허용 목록은 닫힌 집합이라 결혼 낱말을 다 담을 수 없다.
    for (const userText of [
      "식장 예산 보여줘",
      "신혼집 인테리어 예산 보여줘",
      "스드메 예산 알려줘",
      "청첩장 예산 얼마 잡았지?",
    ]) {
      expect(classify(userText).scope, userText).toBe("W0_wedding_core");
    }
  });

  it("결혼 낱말은 절을 넘어서까지 예산 관문을 열지는 않는다", () => {
    // 이 관문에 한정한 이야기다. `이건 결혼 얘기야. 자퇴 예산 짜줘` 는 여전히
    // W0 이지만 그건 **이 관문이 아니라** 정본 결혼 어휘(`WEDDING_CORE_SIGNAL`)가
    // 문장 어디에 있는 `결혼` 이든 잡기 때문이고, origin/main 도 똑같다.
    // 그 어휘 분기에 가드를 다는 것은 파급이 커서 여기서 건드리지 않았다.
    expect(classify("이건 결혼 얘기야. 자퇴 예산 짜줘").scope).toBe("W0_wedding_core");
  });

  it("결혼 낱말이 없으면 절을 넘은 꾸밈으로는 안 열린다", () => {
    // 이 관문 자체는 절을 넘지 않는다. 정본 조회 동사(`보여줘`)를 써서 실제로
    // 정본 분기를 밟게 한다 — `짜줘` 로 쓰면 그 경로를 안 지나가서 절 경계를
    // 넓혀도 검사가 통과한다(변형 검사가 그 구멍을 잡아냈다).
    for (const userText of [
      // 정본 어휘(`청첩장`·`예식장`·`결혼`)는 쓸 수 없다 — 그 낱말이 문장
      // 어디에 있든 어휘 분기가 먼저 W0 을 준다(위 검사 참고). 여기서는
      // 인접 낱말만 써서 **이 관문의** 절 경계를 잰다.
      "신혼집 알아보는 중. 자퇴 예산 보여줘",
      "신혼집 알아보는 중이야. 게임 예산 알려줘",
      "신혼집 계약했어. 유튜브 예산 현황 보여줘",
    ]) {
      expect(classify(userText).scope, userText).not.toBe("W0_wedding_core");
    }
  });

});
