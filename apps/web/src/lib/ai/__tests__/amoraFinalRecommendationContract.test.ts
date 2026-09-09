import { describe, expect, it } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { buildAmoraPendingActionPrompt } from "@/lib/ai/amoraPendingAction";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import {
  selectAmoraPendingProposalTools,
  selectAmoraTools,
} from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { getAvailableChatTools } from "@/lib/ai/placeSearchRouting";
import {
  determineStage,
  matchedSpecialistByKeyword,
  routeSpecialist,
} from "@/lib/ai/stage-router";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

type PromptContext = Parameters<typeof buildAmoraSystemPrompt>[0];
type PromptOptions = Parameters<typeof buildAmoraSystemPrompt>[1];

// 후보 a00d5548에서 최종 답변의 첫 추천 명칭과 뒤의 미확인 단서가 충돌한 요청이다.
// 모델 응답 품질 대신, 이 요청으로 조합되는 최종 지침의 전달과 범위만 검사한다.
const ACTUAL_T3 = "앞에서 전달한 A와 B의 공개 의견을 기준으로 이제 둘의 의견을 중재해줘. 누가 양보하라고만 하지 말고, 각자 밑바탕 가치가 뭔지 짚고 예산·하객·장소를 묶은 절충안 3개와 추천 1순위를 제시해.";
const RECOMMENDATION_HEADING = "[추천 근거 확인]";
const RECOMMENDATION_RULE = "- 추천에 필요한 견적·예산·인원·날짜가 미확인이면 처음부터 끝까지 검토 후보, 순위는 검토 1순위로 쓰세요. 확인된 조건의 비교와 일반 준비 순서 추천은 가능합니다.";
const PIVOT_RULE = "- 예식 형태·지역 전환, 하객 규모 절반 이하·2배 이상이면 현재 바꾼 대상의 이유는 한 번만 묻되 이미 말했으면 건너뛰고 탐색을 이어가세요. 기존 우선순위나 직전 AI 제안의 이유로 바꾸지 마세요. 그 이유에 답한 턴에는 유지할 것과 다시 정할 것을 한 답변에 둘 다 짚으세요: 바꾸지 않은 명시적 선호·우선순위·생략·시기는 빠뜨리지 말고, 영향받는 규모·식사·견적은 재검토하세요. 작은 월 선호는 되묻지 마세요.";
const QUESTION_SCOPE_HEADING = "[서버 확정 질문 범위 계약]";

const BASE_CONTEXT: PromptContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  preparationStatus: null,
  brideName: null,
  groomName: null,
  senderName: "합성 QA",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
  pastDecisions: [],
  pastConflicts: [],
};

function selectedOptions(userText: string): PromptOptions {
  const questionScope = classifyAmoraQuestionScope({ userText });
  const specialist = routeSpecialist(userText, determineStage(null));
  const candidateTools = getAvailableChatTools({
    requestKind: "chat",
    isDurableUserMessageBound: true,
    tools: BETA_SAFE_TOOLS,
  });
  const selectionInput = {
    availableTools: candidateTools,
    userText,
    specialistType: specialist,
    specialistMatchedByKeyword: matchedSpecialistByKeyword(userText),
    attachmentKind: "none" as const,
    checklistLabels: [],
  };
  const reads = filterAmoraToolsByQuestionScope(
    selectAmoraTools(selectionInput).filter(tool => !isMutatingTool(tool.name)),
    questionScope,
  );
  const proposals = filterAmoraToolsByQuestionScope(
    selectAmoraPendingProposalTools({
      ...selectionInput,
      availableTools: BETA_SAFE_TOOLS.filter(tool => isMutatingTool(tool.name)),
    }).filter(tool => getAmoraActionApprovalPolicy(tool.name) !== "blocked"),
    questionScope,
  );
  return {
    requestKind: "chat",
    persistenceMode: "durable",
    specialist,
    questionScope,
    enabledToolNames: reads.map(tool => tool.name),
    actionContract: proposals.length > 0
      ? { kind: "proposal", text: buildAmoraPendingActionPrompt(proposals) }
      : undefined,
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  };
}

function expectProtectedRecommendation(prompt: string): void {
  expect(prompt).toContain(`${PIVOT_RULE}\n\n${RECOMMENDATION_HEADING}\n${RECOMMENDATION_RULE}`);
  expect(prompt.indexOf(QUESTION_SCOPE_HEADING)).toBeGreaterThan(prompt.indexOf(RECOMMENDATION_RULE));
  expect(prompt.split(RECOMMENDATION_RULE)).toHaveLength(2);
  expect(prompt.split(PIVOT_RULE)).toHaveLength(2);
  expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
  expect(prompt.length - prompt.indexOf(RECOMMENDATION_RULE) - RECOMMENDATION_RULE.length)
    .toBeLessThan(500);
  expect(prompt).toContain("**미검증은 이름부터**");
  expect(prompt).toContain("첫 제목부터 끝까지 같은 이름");
}

const SATURATED_FIELD = "가".repeat(2_000);
const SATURATED_PROFILE = {
  personaSummary: SATURATED_FIELD,
  budgetPosture: SATURATED_FIELD,
  decisionStyle: SATURATED_FIELD,
  tasteProfile: SATURATED_FIELD,
  communicationStyle: SATURATED_FIELD,
  conflictPattern: SATURATED_FIELD,
  sensitiveTopics: [SATURATED_FIELD],
  recommendationRules: [SATURATED_FIELD],
  openQuestions: [SATURATED_FIELD],
  confidenceScore: 0.9,
};
const ADDITIONAL_COMPOSITIONS: Array<{
  name: string;
  userText: string;
  context?: Partial<PromptContext>;
  noTools?: boolean;
  mustTruncate?: boolean;
}> = [
  { name: "실제 T3의 no-tools 최종 답변", userText: ACTUAL_T3, noTools: true },
  {
    name: "실제 T3와 포화된 공유·개인 프로필",
    userText: ACTUAL_T3,
    context: { amoraProfiles: { shared: SATURATED_PROFILE, private: SATURATED_PROFILE } },
    mustTruncate: true,
  },
  {
    name: "실제 T3와 긴 대화 요약",
    userText: ACTUAL_T3,
    context: {
      chatSummaries: Array.from({ length: 30 }, (_, index) =>
        `합성 요약 ${index}. 두 사람의 준비 조건을 확인함. `.repeat(30)),
    },
    mustTruncate: true,
  },
  {
    name: "확인된 조건 안에서 하는 비교 추천",
    userText: "결혼식 장소 A안은 서면 견적 총액 1,000만 원, B안은 1,050만 원이고 둘 다 150명이 가능해. 상한 1,200만 원 안에서 비교 추천해줘.",
  },
  {
    name: "일반적인 준비 순서 추천",
    userText: "결혼식 준비에서 계약 전에 하객 명단과 예산 정리 중 무엇부터 하면 좋은지 준비 순서를 추천해줘.",
  },
];

describe("추천 근거 지침은 마지막 보호 구간에 전달된다", () => {
  it("실제 추천 1순위 요청의 도구·제안 조합에서 pivot 뒤, 질문 범위 앞에 온다", () => {
    const options = selectedOptions(ACTUAL_T3);
    expect(options.specialist).toBe("budget_optimizer");
    expect(options.enabledToolNames?.length).toBeGreaterThan(0);
    expect(options.actionContract?.kind).toBe("proposal");

    const prompt = buildAmoraSystemPrompt(BASE_CONTEXT, options);
    expectProtectedRecommendation(prompt);
  });

  it.each(ADDITIONAL_COMPOSITIONS)("$name에서도 명칭·예외·길이·보호 순서를 유지한다", testCase => {
    const selected = selectedOptions(testCase.userText);
    const options = testCase.noTools ? { ...selected, enabledToolNames: [] } : selected;
    const context = { ...BASE_CONTEXT, ...testCase.context };
    const prompt = buildAmoraSystemPrompt(context, options);
    expectProtectedRecommendation(prompt);

    const contract = prompt.slice(
      prompt.indexOf(RECOMMENDATION_HEADING),
      prompt.indexOf(QUESTION_SCOPE_HEADING),
    );
    expect(contract).toContain("추천에 필요한");
    expect(contract).toContain("확인된 조건의 비교와 일반 준비 순서 추천은 가능합니다");

    if (testCase.mustTruncate) {
      expect(prompt, "절단이 실제 발생하는 입력에서 필수 꼬리를 확인한다")
        .toContain("길이 제한으로 생략됨");
      const unbounded = buildAmoraSystemPrompt(context, { ...options, maxChars: undefined });
      expect(unbounded.length).toBeGreaterThan(AMORA_SYSTEM_PROMPT_MAX_CHARS);
      for (const heading of [
        "## 판정 금지 · 업체 상대 발언 금지",
        "## 할루시네이션 방지",
        "## 출처 표기 (Source Citation) — 사용자 신뢰의 핵심",
        "## 대화 규칙",
      ]) {
        expect(prompt).toContain(heading);
      }
    }
  });

  it("재배치한 pivot 233자와 추천 보호 구간 106자의 정확한 길이를 유지한다", () => {
    const prompt = buildAmoraSystemPrompt(BASE_CONTEXT, selectedOptions(ACTUAL_T3));
    const pivot = prompt.split("\n").find(line => line.includes("하객 규모") && line.includes("이유는 한 번만"));
    expect(pivot).toBe(PIVOT_RULE);
    expect(pivot?.length).toBe(233);
    const addition = prompt.slice(
      prompt.indexOf(RECOMMENDATION_HEADING) - 2,
      prompt.indexOf(RECOMMENDATION_RULE) + RECOMMENDATION_RULE.length,
    );
    expect(addition).toBe(`\n\n${RECOMMENDATION_HEADING}\n${RECOMMENDATION_RULE}`);
    expect(addition.length).toBe(106);
  });

  it("W1 일반 상담에도 같은 계약을 전달한다", () => {
    const options: PromptOptions = {
      ...selectedOptions(ACTUAL_T3),
      questionScope: {
        scope: "W1_wedding_adjacent",
        allowsLongTermMemory: true,
        confidence: "high",
        needsClarification: false,
      },
    };
    expectProtectedRecommendation(buildAmoraSystemPrompt(BASE_CONTEXT, options));
  });
});

describe("추천 지침이 다른 요청 범위를 넓히지 않는다", () => {
  it.each([
    { userText: "죽고 싶어. 지금 나를 해치려고 해.", expectedScope: "W5_safety_override" },
    { userText: "자바스크립트 정렬 알고리즘 코드를 짜줘.", expectedScope: "W4_out_of_scope" },
  ])("$expectedScope에는 준비 추천 계약을 추가하지 않는다", ({ userText, expectedScope }) => {
    const options = selectedOptions(userText);
    expect(options.questionScope?.scope).toBe(expectedScope);
    const prompt = buildAmoraSystemPrompt(BASE_CONTEXT, options);
    expect(prompt).not.toContain(RECOMMENDATION_HEADING);
    expect(prompt).not.toContain(PIVOT_RULE);
    expect(prompt).toContain(QUESTION_SCOPE_HEADING);
  });

  it("별도 mediation 요청은 W1이어도 일반 상담 추천 계약을 받지 않는다", () => {
    const prompt = buildAmoraSystemPrompt(BASE_CONTEXT, {
      requestKind: "mediation",
      persistenceMode: "durable",
      enabledToolNames: [],
      specialist: "general",
      questionScope: {
        scope: "W1_wedding_adjacent",
        allowsLongTermMemory: false,
        confidence: "high",
        needsClarification: false,
      },
      maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
    });
    expect(prompt).toContain("## 요청 기반 조율 (MEDIATION_REQUEST)");
    expect(prompt).not.toContain(RECOMMENDATION_HEADING);
    expect(prompt).not.toContain(PIVOT_RULE);
    expect(prompt).toContain(QUESTION_SCOPE_HEADING);
  });
});
