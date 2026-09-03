import { describe, expect, it } from "vitest";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { buildAmoraPendingActionPrompt } from "@/lib/ai/amoraPendingAction";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import {
  selectAmoraPendingProposalTools,
  selectAmoraTools,
} from "@/lib/ai/amoraToolPolicy";
import { getAvailableChatTools } from "@/lib/ai/placeSearchRouting";

// **원본 프롬프트가 아니라 합성된 프롬프트에 묻는다.**
//
// `prompts.ts` 를 grep 하면 죽은 구간이 "살아 있다"고 답한다. 그래서 입력은
// 운영 코드에서 유도한다 — 도구 선택·범위 필터·차단 정책 필터를 route.ts 와
// 같은 순서로 돌린 결과만 `buildAmoraSystemPrompt` 에 넘긴다.

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function composeLikeProduction(userText: string, decisionCount: number): {
  prompt: string;
  readToolNames: string[];
  proposableToolNames: string[];
} {
  const questionScope = classifyAmoraQuestionScope({ userText });
  const candidateTools = getAvailableChatTools({
    requestKind: "chat",
    isDurableUserMessageBound: true,
    tools: BETA_SAFE_TOOLS,
  });
  const readTools = filterAmoraToolsByQuestionScope(
    selectAmoraTools({
      availableTools: candidateTools,
      userText,
      specialistType: "general",
      checklistLabels: [],
      attachmentKind: "none",
    } as never).filter((tool) => !isMutatingTool(tool.name)),
    questionScope,
  );
  const proposableTools = filterAmoraToolsByQuestionScope(
    selectAmoraPendingProposalTools({
      availableTools: PENDING_ACTION_TOOLS,
      userText,
      specialistType: "general",
      checklistLabels: [],
      attachmentKind: "none",
    } as never).filter((tool) => getAmoraActionApprovalPolicy(tool.name) !== "blocked"),
    questionScope,
  );

  const pastDecisions = Array.from({ length: decisionCount }, (_, index) => ({
    category: ["venue", "budget", "schedule", "dress", "studio"][index % 5],
    decisionType: "user_confirmed",
    title: `결정 ${index + 1}: 예식장 후보 비교`,
    value: `값 ${index + 1} — 그랜드힐 2층, 보증 250명`,
    reasoning: `사용자가 확인함 ${index + 1}`,
    confidence: 0.8,
    source: "amora_chat",
    createdAt: "2026-08-01T10:00:00Z",
    vendorDeliveryStatus: null,
    vendorConfirmationStatus: null,
    internalRequestStatus: null,
    vendorCancellationStatus: null,
    refundStatus: null,
    completionEvidence: null,
  }));

  const context = {
    startingPointAsked: false,
    weddingDate: "2027-05-15",
    budget: 62_000_000,
    venue: "그랜드힐컨벤션",
    progress: {},
    preparationStatus: "preparing",
    brideName: "지은",
    groomName: "민수",
    neutralMemberPresentation: false,
    senderName: "지은",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    preferences: undefined,
    helpPreference: null,
    amoraProfiles: { shared: null, private: null },
    pastDecisions,
    pastConflicts: [],
  };

  const prompt = buildAmoraSystemPrompt(context as never, {
    specialist: "general",
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: readTools.map((tool) => tool.name),
    actionContract: proposableTools.length > 0
      ? { kind: "proposal", text: buildAmoraPendingActionPrompt(proposableTools) }
      : undefined,
    questionScope,
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  } as never);

  return {
    prompt,
    readToolNames: readTools.map((tool) => tool.name),
    proposableToolNames: proposableTools.map((tool) => tool.name),
  };
}

const ETIQUETTE_TAG_INSTRUCTION = "태그를 1~2개 붙이세요";
const ETIQUETTE_NUMBER_TABLE = "**번호표:**";
const ACTION_CARD_CONTRACT = "- 행동 카드는 사용자가 직접 실행할 한 가지 행동에만";
const ACTION_CARD_SURFACE = "라운지 '지금 먼저 볼 것'의 완료·숨김 버튼";
const QUOTE_NO_REPEAT = "본문 텍스트에 다시 나열하지 마세요";

describe("합성된 프롬프트가 스스로 모순되지 않는다", () => {
  it("예절 태그 지시와 번호표는 함께 남거나 함께 빠진다", () => {
    // 절단은 꼬리부터 통째로 잘라내므로, 번호표가 지시보다 뒤에 있으면
    // **번호↔편 매핑 없이 태그를 붙이라고 시키는 상태**가 생긴다. 잘못된 번호는
    // 화면이 조용히 지워서 사용자에게는 카드가 안 뜬 것으로만 보인다.
    //
    // 결정 개수를 늘려 실제로 절단이 일어나는 구간까지 훑는다.
    let sawBoth = false;
    let sawNeither = false;
    let sawTruncated = false;

    for (let decisions = 0; decisions <= 40; decisions += 2) {
      const { prompt } = composeLikeProduction("결혼식 예산 배분 좀 도와줘", decisions);
      const hasInstruction = prompt.includes(ETIQUETTE_TAG_INSTRUCTION);
      const hasTable = prompt.includes(ETIQUETTE_NUMBER_TABLE);

      expect(
        hasInstruction && !hasTable,
        `결정 ${decisions}개: 번호표 없이 태그를 붙이라는 지시만 남았다`,
      ).toBe(false);

      if (hasInstruction && hasTable) sawBoth = true;
      if (!hasInstruction && !hasTable) sawNeither = true;
      if (prompt.includes("길이 제한으로 생략됨")) sawTruncated = true;
    }

    // 위 단언이 "절단이 한 번도 안 일어나서" 통과한 것이 아님을 함께 고정한다.
    expect(sawTruncated, "이 표본은 절단 구간에 닿지 않는다 — 단언이 헛돈다").toBe(true);
    expect(sawBoth, "둘 다 남는 경우가 표본에 없다").toBe(true);
    expect(sawNeither, "둘 다 빠지는 경우가 표본에 없다 — 절단이 이 섹션까지 오지 않았다").toBe(true);
  });

  it("행동 카드 계약이 실린 턴에는 어디서 바꾸는지가 함께 실린다", () => {
    // `update_amora_action` 은 승인 정책상 blocked 라 확인 카드가 되는 경로가
    // 없다. 그러니 "기존 카드를 바꾸려면 action_id 를 확인하세요" 는 이어서 할 수
    // 있는 일이 없는 지시였다. 계약문이 실리면 **실제로 바꿀 수 있는 자리**가
    // 같은 프롬프트에 있어야 한다.
    const utterances = [
      "결혼식 예산 배분 좀 도와줘",
      "12월 3일에 드레스 투어 일정 추가해줘",
      "상견례 때 뭐 챙겨야 해?",
    ];

    let sawContract = false;
    for (const userText of utterances) {
      const { prompt, proposableToolNames } = composeLikeProduction(userText, 0);

      // 이 단언이 위 문장의 전제다 — 도구가 제안 가능해지면 여기서 먼저 실패해서
      // 계약문을 다시 쓸지 함께 판단하게 된다.
      expect(
        proposableToolNames.includes("update_amora_action"),
        `${userText}: update_amora_action 이 제안 가능해졌다`,
      ).toBe(false);

      const hasContract = prompt.includes(ACTION_CARD_CONTRACT);
      if (hasContract) sawContract = true;
      expect(
        hasContract === prompt.includes(ACTION_CARD_SURFACE),
        `${userText}: 행동 카드 계약과 바꾸는 자리 안내가 따로 논다`,
      ).toBe(true);
    }

    expect(sawContract, "표본 어디에도 행동 카드 계약이 실리지 않았다").toBe(true);
  });

  it("견적 중복 나열 금지는 analyze_quote 가 켜진 턴에만 실린다", () => {
    // 이 규칙은 `prompts.ts` 의 죽은 구간에 있어 모델에게 한 번도 가지 않았다.
    // 이제 도구 갈래에 있으므로 **도구 유무와 같은 답**이 나와야 한다.
    for (const userText of [
      "스드메 290 견적 받았는데 봐줘",
      "결혼식 예산 배분 좀 도와줘",
      "상견례 때 뭐 챙겨야 해?",
    ]) {
      const { prompt, readToolNames } = composeLikeProduction(userText, 0);
      expect(
        prompt.includes(QUOTE_NO_REPEAT),
        `${userText}: 나열 금지와 analyze_quote 유무가 어긋난다`,
      ).toBe(readToolNames.includes("analyze_quote"));
    }
  });
});
