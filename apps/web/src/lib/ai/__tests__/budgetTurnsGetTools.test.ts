import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const s = (userText: string) => classifyAmoraQuestionScope({ userText }).scope;

const WANT = [
  "예산은 진짜 감이 없어. 우리 조건이면 총 얼마쯤 잡아야 해? 항목별로도 알려줘.",
  "예산 전체를 항목별로 다시 정리해서 보여줘",
  "그럼 예산이랑 준비 항목은 어떻게 되는 거야?",
  "남은 예산을 항목별로 알아서 배분해줘",
  "예산 짜줘",
  "예산 총액 바꿔줘",
  "예산 감이 아예 없어요. 보통 얼마나 잡아야 하는지 모르겠어요.",
  "항목별 예산 배정 합계랑, 직접 추가한 항목들 다 알려줘",
];

const AVOID = [
  "여행 예산 짜줘", "회사 예산 항목별로 정리해줘", "이사 예산 총 얼마 들어?",
  "자녀 학원 예산 배분 좀 해줘", "보험 예산 얼마나 잡아야 해?",
  "재테크 예산 항목별로 나눠줘", "이민 예산 총 얼마야?", "창업 예산 짜줘",
  "다이어트 식단 예산 얼마야?", "유학 예산 항목별로 알려줘",
  "돌잔치 예산 짜줘", "육아용품 예산 배분해줘", "밴드 장비 예산 짜줘",
  "장례 예산 얼마 잡아야 해?", "주식 투자 예산 짜줘", "부동산 예산 잡아줘",
  "연말정산 항목별로 정리해줘", "반려동물 예산 얼마 잡아?",
];

/** 이 관문보다 앞에 있는 레인. 하나라도 W0 이 되면 관문이 앞으로 새어 나간 것이다. */
const KEEP = [
  ["답답해. 예산 항목 좀 정리해줘", "W3_social_care"],
  ["예산 때문에 남편이 저를 때렸어요", "W2_high_risk_adjacent"],
  ["예산 계약서 조항이 불리한지 봐줘", "W2_high_risk_adjacent"],
  ["안녕! 예산 얘기 좀 하자", "W3_social_care"],
] as const;

/**
 * 남긴 구멍: "배분 필요한 항목이 뭐야?" 는 예산이란 낱말이 없어 여전히 W4 다.
 * 실제 대화에서는 앞 턴("예산 전체를 항목별로...")이 이제 W0 이므로 되묻기
 * 연속성이 살린다. 첫 턴부터 이렇게 묻는 경우는 남는다 — 알면서 남긴 것이고,
 * 이걸 잡으려고 `항목별`을 넣으면 결혼 밖 문장이 함께 들어온다(측정함).
 */
describe("예산 질문이 도구를 받는다", () => {
  it("회복", () => {
    const nl = String.fromCharCode(10);
    const bad = WANT.filter((t) => s(t) !== "W0_wedding_core");
    expect(bad.map((t) => `${s(t)} | ${t}`).join(nl)).toBe("");
  });

  it("결혼 밖 화제는 그대로 막힌다", () => {
    const nl = String.fromCharCode(10);
    const leaked = AVOID.filter((t) => s(t) === "W0_wedding_core").map((t) => `${t}`);
    expect(leaked.join(nl)).toBe("");
  });

  it("앞 레인을 뺏지 않는다", () => {
    for (const [text, want] of KEEP) {
      expect(s(text), text).toBe(want);
    }
  });

  it("기억은 켜지지 않는다", () => {
    // 맨 뒤 관문으로 들어온 턴은 장기 기억을 열지 않는다.
    const c = classifyAmoraQuestionScope({ userText: "예산 짜줘" });
    expect(c.scope).toBe("W0_wedding_core");
    expect(c.allowsLongTermMemory).toBe(false);
  });
});
