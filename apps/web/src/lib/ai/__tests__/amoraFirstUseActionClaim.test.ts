import { describe, expect, it } from "vitest";
import { guardAmoraFirstUseActionClaim } from "@hanbang/shared/amora-first-use-action-claim";

const EMPTY_GROUNDING = {
  version: 1 as const,
  sourceRevision: 7,
  confirmed: [],
  unknowns: [
    { key: "current_progress" as const, label: "이미 마친 준비와 아직 남은 준비" },
  ],
};

describe("guardAmoraFirstUseActionClaim", () => {
  it("keeps a low-risk provider action exact", () => {
    const draft = {
      action: "둘이 예식 시기 후보 두 개 적기",
      reason: "장소를 알아보기 전에 검색 범위를 줄일 수 있어요.",
      completionCriterion: "가능한 시기 두 개와 피하고 싶은 시기 하나를 적으면 끝나요.",
    };

    expect(guardAmoraFirstUseActionClaim({
      ...draft,
      grounding: EMPTY_GROUNDING,
    })).toEqual(draft);
  });

  it("fails closed for malformed provider fields or a non-canonical grounding envelope", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "",
      reason: "이유",
      completionCriterion: "완료",
      grounding: EMPTY_GROUNDING,
    })).toBeNull();
    expect(guardAmoraFirstUseActionClaim({
      action: "다음 준비 확인하기\u202e",
      reason: "이유",
      completionCriterion: "완료",
      grounding: EMPTY_GROUNDING,
    })).toBeNull();
    expect(guardAmoraFirstUseActionClaim({
      action: "다음 준비 확인하기",
      reason: "이유",
      completionCriterion: "완료",
      grounding: { ...EMPTY_GROUNDING, privateText: "근거처럼 보이는 원문" },
    })).toBeNull();
  });

  it("replaces invented contract and payment claims with a grounded verification action", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "신라호텔 예약금 300만원 결제 완료로 기록하기",
      reason: "업체와 계약이 확정됐어요.",
      completionCriterion: "잔금 700만원을 보내면 끝나요.",
      grounding: {
        version: 1,
        sourceRevision: 8,
        confirmed: [
          { key: "venue", label: "결혼식장: 정원홀" },
        ],
        unknowns: [],
      },
    })).toEqual({
      action: "정원홀 계약·결제 상태 확인하기",
      reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
      completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
    });
  });

  it("keeps a provider-authored contract verification action exact", () => {
    const draft = {
      action: "계약 확정 여부 확인하기",
      reason: "계약 상태가 아직 준비 기록에 없어서 먼저 확인이 필요해요.",
      completionCriterion: "계약서에서 서명 여부와 금액을 확인해 적으면 끝나요.",
    };

    expect(guardAmoraFirstUseActionClaim({
      ...draft,
      grounding: EMPTY_GROUNDING,
    })).toEqual(draft);
  });

  it("does not let a trailing verification phrase launder a payment claim", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "예약금 결제는 완료됐으니 결제 내역 확인하기",
      reason: "입금이 끝났으니 영수증만 보면 돼요.",
      completionCriterion: "결제 내역을 확인하면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "계약·결제 상태 확인하기",
      reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
      completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
    });
  });

  it("turns an unsupported signing or payment instruction into verification", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "정원홀 계약서에 서명하고 예약금 결제하기",
      reason: "지금 계약해야 자리를 잡을 수 있어요.",
      completionCriterion: "예약금을 입금하면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "계약·결제 상태 확인하기",
      reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
      completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
    });
  });

  it("replaces an unsupported money claim with a low-risk amount check", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "드레스 예산을 500만원으로 확정하기",
      reason: "우리 드레스 예산이 500만원으로 정해졌어요.",
      completionCriterion: "500만원 배분표를 만들면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "둘이 사용할 금액 기준 확인하기",
      reason: "저장된 준비 기록에서 이 금액을 확인하지 못해 먼저 기준을 맞출 필요가 있어요.",
      completionCriterion: "두 사람이 사용할 범위를 확인해 전체 예산 기록에 남기면 끝나요.",
    });
  });

  it("treats a won-symbol amount without a trailing 원 as a money claim", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "전체 예산을 ₩30,000,000으로 확정하기",
      reason: "우리에게 맞는 예산은 ₩30,000,000이에요.",
      completionCriterion: "₩30,000,000 안에서 항목별 범위를 적으면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "둘이 사용할 금액 기준 확인하기",
      reason: "저장된 준비 기록에서 이 금액을 확인하지 못해 먼저 기준을 맞출 필요가 있어요.",
      completionCriterion: "두 사람이 사용할 범위를 확인해 전체 예산 기록에 남기면 끝나요.",
    });
  });

  it("keeps the exact total budget when canonical grounding supports it", () => {
    const draft = {
      action: "전체 예산 30,000,000원 안에서 우선순위 세 개 정하기",
      reason: "저장된 전체 예산 30,000,000원을 먼저 나눠보면 선택 범위를 줄일 수 있어요.",
      completionCriterion: "30,000,000원 안에서 세 항목의 범위를 적으면 끝나요.",
    };

    expect(guardAmoraFirstUseActionClaim({
      ...draft,
      grounding: {
        version: 1,
        sourceRevision: 9,
        confirmed: [
          { key: "total_budget", label: "전체 예산: 30,000,000원" },
        ],
        unknowns: [],
      },
    })).toEqual(draft);
  });

  it("does not treat a shared comma-group suffix as money evidence", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "전체 예산을 130,000,000원으로 정하기",
      reason: "전체 예산이 130,000,000원으로 정해졌어요.",
      completionCriterion: "130,000,000원 안에서 항목별 범위를 적으면 끝나요.",
      grounding: {
        version: 1,
        sourceRevision: 10,
        confirmed: [
          { key: "total_budget", label: "전체 예산: 30,000,000원" },
        ],
        unknowns: [],
      },
    })).toEqual({
      action: "둘이 사용할 금액 기준 확인하기",
      reason: "저장된 준비 기록에서 이 금액을 확인하지 못해 먼저 기준을 맞출 필요가 있어요.",
      completionCriterion: "두 사람이 사용할 범위를 확인해 전체 예산 기록에 남기면 끝나요.",
    });
  });

  it("never treats an unknown grounding label or raw private text as money evidence", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "드레스 예산을 500만원으로 확정하기",
      reason: "500만원이 우리 예산이에요.",
      completionCriterion: "500만원 안에서 고르면 끝나요.",
      privateText: "나는 500만원이라고 말했어",
      grounding: {
        version: 1,
        sourceRevision: 11,
        confirmed: [],
        unknowns: [
          { key: "total_budget", label: "전체 예산: 500만원" },
        ],
      },
    } as Parameters<typeof guardAmoraFirstUseActionClaim>[0] & {
      privateText: string;
    })).toEqual({
      action: "둘이 사용할 금액 기준 확인하기",
      reason: "저장된 준비 기록에서 이 금액을 확인하지 못해 먼저 기준을 맞출 필요가 있어요.",
      completionCriterion: "두 사람이 사용할 범위를 확인해 전체 예산 기록에 남기면 끝나요.",
    });
  });

  it("replaces an unsupported deadline with a low-risk date check", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "2026-08-20까지 식장 후보 확정하기",
      reason: "준비 마감이 2026-08-20이에요.",
      completionCriterion: "2026-08-20까지 후보 하나를 고르면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "실제 마감일 확인하기",
      reason: "저장된 일정에서 이 마감일을 확인하지 못해 먼저 날짜를 확인해야 해요.",
      completionCriterion: "확인한 날짜를 일정에 남기고, 그 날짜까지 할 한 가지를 정하면 끝나요.",
    });
  });

  it("does not turn a provider-authored relative date into a deadline", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "다음 주 토요일까지 예식장 후보 확정하기",
      reason: "그날이 우리 준비 마감이에요.",
      completionCriterion: "다음 주 토요일까지 하나를 고르면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "실제 마감일 확인하기",
      reason: "저장된 일정에서 이 마감일을 확인하지 못해 먼저 날짜를 확인해야 해요.",
      completionCriterion: "확인한 날짜를 일정에 남기고, 그 날짜까지 할 한 가지를 정하면 끝나요.",
    });
  });

  it("keeps an exact date already present in canonical schedule grounding", () => {
    const draft = {
      action: "2026-08-20 부모님 첫 만남 전에 질문 세 개 적기",
      reason: "저장된 다음 일정인 2026-08-20 부모님 첫 만남을 편하게 준비할 수 있어요.",
      completionCriterion: "2026-08-20 전에 둘이 질문 세 개를 확인하면 끝나요.",
    };

    expect(guardAmoraFirstUseActionClaim({
      ...draft,
      grounding: {
        version: 1,
        sourceRevision: 10,
        confirmed: [
          { key: "next_schedule", label: "다음 일정: 2026-08-20 · 부모님 첫 만남" },
        ],
        unknowns: [],
      },
    })).toEqual(draft);
  });

  it("replaces an unsupported partner-agreement claim with separate confirmation", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "둘이 합의한 호텔 예식 기준으로 후보 고르기",
      reason: "두 사람이 호텔 예식에 동의했어요.",
      completionCriterion: "합의한 조건에 맞는 후보 하나를 고르면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "두 사람이 같은 선택에 동의하는지 확인하기",
      reason: "공동 준비 기록에서 두 사람의 합의를 확인하지 못해 각각 확인이 필요해요.",
      completionCriterion: "두 사람이 각자 같은 선택을 확인하면 끝나요.",
    });
  });

  it("also blocks a colloquial unsupported couple agreement", () => {
    expect(guardAmoraFirstUseActionClaim({
      action: "우린 호텔 예식으로 합의했으니 장소 고르기",
      reason: "서로 호텔 예식으로 결정했어요.",
      completionCriterion: "호텔 하나를 고르면 끝나요.",
      grounding: EMPTY_GROUNDING,
    })).toEqual({
      action: "두 사람이 같은 선택에 동의하는지 확인하기",
      reason: "공동 준비 기록에서 두 사람의 합의를 확인하지 못해 각각 확인이 필요해요.",
      completionCriterion: "두 사람이 각자 같은 선택을 확인하면 끝나요.",
    });
  });

  it("keeps a future two-person confirmation criterion exact", () => {
    const draft = {
      action: "예식 시기 후보 두 개를 함께 보기",
      reason: "서로 가능한 시기를 좁힐 수 있어요.",
      completionCriterion: "두 사람이 같은 후보에 동의하면 끝나요.",
    };

    expect(guardAmoraFirstUseActionClaim({
      ...draft,
      grounding: EMPTY_GROUNDING,
    })).toEqual(draft);
  });
});
