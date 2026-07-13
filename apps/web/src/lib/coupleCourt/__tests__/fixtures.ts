import type {
  CourtCategory,
  CourtMode,
  CourtVerdict,
} from "@/lib/coupleCourt/types";

export function makeValidCourtVerdict(options: {
  mode?: CourtMode;
  category?: CourtCategory;
} = {}): CourtVerdict {
  const mode = options.mode ?? "couple";
  const category = options.category ?? "budget";
  return {
    schemaVersion: "1.0",
    safety: {
      level: "normal",
      riskTypes: [],
      disablePlayfulVerdict: false,
      publicEligible: true,
      supportMessage: null,
    },
    caseMeta: {
      generatedTitle: "추가금 합의 기준을 다시 세운 사건",
      category,
      provisional: mode === "solo",
    },
    caseSummary: "추가 비용을 결정하기 전에 서로 확인해야 하는 기준과 답변 시점이 달랐습니다.",
    sharedFacts: ["추가 비용이 발생했고 공동 예산에 영향을 줍니다."],
    differentViews: [{
      applicant: "결제 전에 확인받기를 기대했습니다.",
      respondent: mode === "couple" ? "마감이 임박해 먼저 결정해야 한다고 생각했습니다." : null,
    }],
    applicantNeeds: "공동 비용을 결제하기 전 확인받는 과정",
    partnerNeeds: mode === "couple" ? "결정 가능한 답변 마감과 예산 기준" : null,
    coreConflict: "선택 자체보다 사전 상의의 기준과 시점이 달랐습니다.",
    responsibility: mode === "couple" ? {
      displayMode: "percentage",
      applicant: 25,
      respondent: 35,
      shared: 40,
      explanation: "답변 지연과 사전 결제, 불명확한 공동 규칙이 함께 영향을 줬습니다.",
    } : {
      displayMode: "qualitative",
      applicant: null,
      respondent: null,
      shared: null,
      explanation: "한쪽 진술만 있어 비율 대신 확인할 쟁점을 제안합니다.",
    },
    verdict: {
      status: "settlement_recommended",
      headline: "공동 비용은 결제 전 확인 규칙부터 정해요",
      reasons: ["답변 마감과 무응답 시 처리 원칙이 없었습니다."],
      judgeOneLiner: "추가금보다 먼저 추가할 것은 합의 규칙입니다.",
    },
    conversationScript: {
      opening: "이번 선택보다 다음 결제를 어떻게 확인할지 먼저 정해 볼까?",
      applicantLine: "나는 공동 비용을 결제하기 전에 한 번 확인받고 싶어.",
      respondentLine: mode === "couple" ? "나는 답변 마감이 정해지면 그 안에 꼭 확인할게." : null,
    },
    missions: [{
      title: "공동 결제 기준 적기",
      description: "금액 상한과 답변 마감, 무응답 시 처리 방법을 한 문장으로 적어요.",
      owner: mode === "couple" ? "both" : "applicant",
      dueInMinutes: 1440,
      completionCheck: "합의 문장을 각자 확인하면 완료예요.",
      funTag: null,
      relatedFeature: "task",
    }],
    checkIn: {
      dueInDays: 3,
      question: "새 결제 규칙이 실제 결정에 도움이 됐나요?",
    },
    confidence: mode === "couple" ? "medium" : "low",
    limitations: [mode === "couple"
      ? "제출된 두 진술 외 사실을 독립적으로 확인하지 않았습니다."
      : "한쪽 진술만 바탕으로 한 임시 정리입니다."],
    publicCard: {
      safeTitle: "추가금 합의 기준을 다시 세운 사건",
      oneLine: "공동 비용은 결제 전에 답변 마감과 상한을 확인하기로 했어요.",
      resultLabel: "사전 합의 권고",
      hashtags: ["결혼예산", "커플합의"],
    },
  };
}
