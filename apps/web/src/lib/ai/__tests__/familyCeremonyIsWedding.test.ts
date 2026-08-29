/**
 * "가족식" 은 결혼식 형태다.
 *
 * `스몰웨딩`·`노웨딩`·`일반웨딩` 은 `웨딩` 으로 걸리는데 가족식만 어느 낱말에도
 * 안 걸려 W4 로 떨어졌다. W4 턴은 provider 에게 현재 메시지 하나만 가므로
 * (`route.ts` 의 `providerMessages`) 아모라가 직전까지의 조건을 볼 수 없다.
 *
 * ## 경계는 조사로 판다
 *
 * 막아야 할 합성어는 끝이 없고(`가족식사`·`가족식당`·`가족식품`·`가족식단`·
 * `가족식탁`·`가족식비`·`가족식료품`·`가족식습관`·`가족식중독` — 적대적 검토가
 * 세 개 적은 목록에서 여섯 개를 더 찾았다) **조사는 닫힌 집합**이다. 그래서
 * 조사를 적는다. 조사 목록이 짧았을 때는 `가족식부터`·`가족식하고`·`가족식까지`·
 * `가족식같은` 이 막혔다.
 */
import { describe, expect, it } from "vitest";

import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const scope = (userText: string) => classifyAmoraQuestionScope({ userText }).scope;

describe("가족식은 결혼 이야기다", () => {
  it.each([
    "생각해보니 그냥 40명 정도 가족식으로 하는 게 나을 것 같아.",
    "가족식으로 바꾸면 예산이 얼마나 줄어?",
    "일반예식 말고 가족식이 나을까?",
    "가족식부터 알아보고 싶어",
    "가족식하고 저녁 식사만 할 거야",
    "가족식까지 생각하면 몇 명이나 부를까",
    "가족식같은 형태도 되나?",
    "가족식은 몇 명까지가 보통이야?",
    "가족식도 사진은 남기고 싶어",
  ])("%s", (userText) => {
    expect(scope(userText)).toBe("W0_wedding_core");
  });

  it("이미 있던 예식 형태 낱말과 같은 판정을 받는다", () => {
    // 대조군. 이 셋은 예전에도 W0 이었다 — 가족식만 빠져 있었다.
    for (const userText of [
      "생각해보니 그냥 스몰웨딩으로 하는 게 나을 것 같아.",
      "생각해보니 그냥 노웨딩으로 하는 게 나을 것 같아.",
      "생각해보니 그냥 일반웨딩으로 하는 게 나을 것 같아.",
    ]) {
      expect(scope(userText), userText).toBe("W0_wedding_core");
    }
  });

  it("앞 세 글자가 겹치는 다른 낱말은 끌어오지 않는다", () => {
    for (const userText of [
      "주말 가족식사 어디서 할지 고민이야",
      "가족식당 예약 알려줘",
      "가족식품 코너에서 뭘 사야 해?",
      "가족식단 짜줘",
      "가족식탁 어디서 사?",
      "가족식비 얼마 들어?",
      "가족식료품 사야 해",
      "가족식습관 고치고 싶어",
      "가족식중독 조심해야지",
    ]) {
      expect(scope(userText), userText).not.toBe("W0_wedding_core");
    }
  });
});
