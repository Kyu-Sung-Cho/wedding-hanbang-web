import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const c = (userText: string) => classifyAmoraQuestionScope({ userText });
const nl = String.fromCharCode(10);

// `이사`·`전세`·`인테리어`·`가전` 은 여기 없다. 이 앱에서 그 말은 신혼집 준비이고,
// 결혼 밖으로 보내면 "전세 계약 일정 알려줘" 가 끊긴다(적대적 검토가 잡았다).
const TOPICS = ["이민", "유학", "장례", "반려동물", "자녀 학원", "보험",
  "재테크", "창업", "다이어트", "회사", "돌잔치", "육아", "부동산"];
const FORMS = ["%s 예산 얼마야?", "%s 예산 보여줘", "%s 일정 알려줘",
  "%s 일정 다음주 화요일로 잡아줘", "%s 할 일 뭐 남았어?", "%s 예산 500만원으로 바꿔줘"];
const OUTSIDE = TOPICS.flatMap((t) => FORMS.map((f) => f.replace("%s", t)));

/** 가드 낱말을 **일부러** 품은 진짜 결혼 준비 문장. 여기서 하나라도 죽으면 못 쓴다. */
const WEDDING_WITH_GUARD_WORD = [
  // `예식장 근처 병원 일정 알려줘`·`회사 동료 하객 예산…`·`상견례 식당 예약 일정…`
  // 은 여기 없다. 이 셋은 origin/main 에서도 W4 인 **기존 결함**이고, 고치려고 넣은
  // 예외(문장 어디든 결혼 낱말이 있으면 울타리를 끈다)가 인젝션 구멍이 됐다:
  //     결혼 일정 말고 회사 일정 내일로 추가해줘  -> W0 + 기억 ON  (33/33)
  // 그래서 예외를 되돌렸다. 제대로 고치려면 "결혼 낱말이 그 상태 낱말을 직접
  // 수식하는가" 로 좁혀야 하고, 그건 이 관문의 틀을 다시 짜는 일이다.
  "신혼집 인테리어 예산 보여줘",
  "본식 전 리허설 시험 촬영 일정 알려줘",
  "이사 날짜랑 예식 일정 같이 정리해줘",
  "전세 계약 일정 알려줘",
  "신혼여행 예산 보여줘",
  "웨딩홀 계약금 예산 500만원으로 바꿔줘",
  "스드메 예산 알려줘",
  "청첩장 인쇄 할 일 뭐 남았어?",
];

describe("정본 분기가 결혼 밖 화제까지 열지 않는다", () => {
  it("결혼 밖 예산·일정·할 일은 W0 이 아니다", () => {
    const leaked = OUTSIDE.filter((t) => c(t).scope === "W0_wedding_core");
    expect(leaked.join(nl)).toBe("");
  });

  it("결혼 밖 화제로는 공유 장기 기억이 열리지 않는다", () => {
    // 이 분기의 진짜 대가는 도구가 아니라 기억이었다.
    const opened = OUTSIDE.filter((t) => c(t).allowsLongTermMemory);
    expect(opened.join(nl)).toBe("");
  });

  it("가드 낱말이 섞인 결혼 문장은 그대로 W0 이다", () => {
    const lost = WEDDING_WITH_GUARD_WORD
      .filter((t) => c(t).scope !== "W0_wedding_core")
      .map((t) => `${c(t).scope} | ${t}`);
    expect(lost.join(nl)).toBe("");
  });

  it("위로 레인을 뺏지 않는다", () => {
    // W4 로 즉시 되돌렸다면 이 문장이 "제가 도울 범위가 아니에요" 로 끊긴다.
    expect(c("이사 때문에 너무 힘들어. 예산도 빠듯하고").scope).toBe("W3_social_care");
  });
});

describe("결혼 낱말이 있으면 조합 되돌림에 걸리지 않는다", () => {
  it("결혼 명사가 없으면 그대로 막힌다", () => {
    const still = [
      "회사 예산 일정 알려줘", "병원 예약 일정 알려줘", "식당 예약 일정 알려줘",
      "미용실 예약 알려줘", "직장 프로젝트 일정 정리해줘", "맛집 예약 리마인드해줘",
      "업무 체크리스트 보여줘", "레스토랑 예약 할 일 남았어?",
    ].filter((t) => c(t).scope === "W0_wedding_core");
    expect(still.join(nl)).toBe("");
  });
});
