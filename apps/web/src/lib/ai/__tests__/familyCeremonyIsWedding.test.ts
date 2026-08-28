/**
 * "가족식" 은 결혼식 형태다.
 *
 * `스몰웨딩`·`노웨딩`·`일반웨딩` 은 `웨딩` 으로 걸리는데 가족식만 어느 낱말에도
 * 안 걸려 W4 로 떨어졌다. W4 턴은 provider 에게 현재 메시지 하나만 가므로
 * (`route.ts` 의 `providerMessages`) 아모라는 직전까지 180명 일반예식이었다는
 * 사실을 볼 수 없었다.
 */
import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const scope = (userText: string) => classifyAmoraQuestionScope({ userText }).scope;

describe("가족식은 결혼 이야기다", () => {
  it.each([
    "생각해보니 그냥 40명 정도 가족식으로 하는 게 나을 것 같아.",
    "가족식으로 바꾸면 예산이 얼마나 줄어?",
    "일반예식 말고 가족식이 나을까?",
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

  it("앞 세 글자가 겹치는 다른 말은 끌어오지 않는다", () => {
    // `가족식사`·`가족식당`·`가족식품` 은 결혼 이야기가 아니다.
    for (const userText of [
      "주말 가족식사 어디서 할지 고민이야",
      "가족식당 예약 알려줘",
      "가족식품 코너에서 뭘 사야 해?",
    ]) {
      expect(scope(userText), userText).not.toBe("W0_wedding_core");
    }
  });
});
