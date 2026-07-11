import { describe, expect, it } from "vitest";
import {
  hasImmediateKoreanCrisisSignal,
  KOREAN_CRISIS_SAFETY_RESPONSE,
} from "../crisisSafety";

describe("hasImmediateKoreanCrisisSignal", () => {
  it.each([
    "살고 싶지 않아",
    "나 그냥 사라지고 싶어",
    "죽어버릴래",
    "그냥 죽을래",
    "차라리 죽는 게 낫겠어",
    "죽어야겠다",
    "요즘 계속 죽고 싶어요",
    "자살하고 싶어",
    "내 목숨을 끊고 싶다",
    "내 인생을 끝내고 싶어",
    "극단적인 선택을 할까",
    "제가 오늘 죽을 거예요",
    "내 몸을 스스로 해치고 싶어",
    "고통 없이 죽는 방법을 알려줘",
    "다시는 깨어나고 싶지 않아",
    "[신부]  죽 고   싶어",
  ])("detects a clear first-person or actionable crisis expression: %s", (text) => {
    expect(hasImmediateKoreanCrisisSignal(text)).toBe(true);
  });

  it.each([
    "죽고 싶지 않아",
    "죽고 싶다는 생각은 전혀 없어",
    "죽고 싶은 건 아니야",
    "자살할 생각은 없어",
    "자살하지 않을 거야",
    "자살하고 싶은 게 아니야",
    "살고 싶지 않은 건 아니야",
    "사라지고 싶지 않아요",
    "죽도록 피곤해",
    "죽을 만큼 일정이 많아",
    "이 화분은 물을 안 주면 죽을 거야",
    "이 동네에서는 살고 싶지 않아",
    "자살 예방 상담전화가 뭐야?",
    "‘죽고 싶어’라는 표현을 순화해줘",
    "죽고 싶다는 대사를 자연스럽게 고쳐줘",
    "웨딩 준비를 다 끝내고 싶어",
    "이 광고가 화면에서 사라졌으면 좋겠어",
    "계약서를 없애고 싶어",
  ])("does not flag an explicit negation, idiom, quotation, or ordinary request: %s", (text) => {
    expect(hasImmediateKoreanCrisisSignal(text)).toBe(false);
  });

  it("does not let an earlier negation hide a later clear crisis statement", () => {
    expect(hasImmediateKoreanCrisisSignal(
      "아까는 죽고 싶지 않았어. 그런데 지금은 죽어버릴래."
    )).toBe(true);
  });

  it("returns only a boolean so the matched sensitive phrase is not propagated", () => {
    expect(typeof hasImmediateKoreanCrisisSignal("죽고 싶어")).toBe("boolean");
  });
});

describe("KOREAN_CRISIS_SAFETY_RESPONSE", () => {
  it("gives immediate Korean help routes without diagnosing or promising treatment", () => {
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).toContain("112");
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).toContain("119");
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).toContain("24시간 자살예방상담전화 109");
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).toContain("혼자 있지 말고");
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).toContain("당장 위험해요");
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).toContain("지금은 안전해요");
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).toContain("응급·의료 서비스를 대신할 수 없지만");
    expect(KOREAN_CRISIS_SAFETY_RESPONSE).not.toMatch(/진단|치료해|반드시 괜찮|완치/);
  });
});
