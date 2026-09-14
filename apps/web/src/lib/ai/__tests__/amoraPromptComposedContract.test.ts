import { describe, expect, it } from "vitest";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS, WEDDING_TOOLS } from "@/lib/ai/tools";
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

function composeLikeProduction(
  userText: string,
  decisionCount: number,
  // 운영 도구 선택 대신 도구 목록을 직접 정할 때만 — 도구 0개 갈래를 강제로 보는 용도.
  enabledToolNamesOverride?: readonly string[],
): {
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
    enabledToolNames: enabledToolNamesOverride ?? readTools.map((tool) => tool.name),
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
const ACTION_CARD_SURFACE = "결정 보드 '공유 할 일'의 완료·숨김 버튼";
const QUOTE_NO_REPEAT = "본문에 다시 나열하지 마세요";

describe("합성된 프롬프트가 스스로 모순되지 않는다", () => {
  it("우선순위가 낮은 항목을 제외로 확장하지 않는 규칙을 긴 문맥에서도 전달한다", () => {
    for (const decisionCount of [0, 40]) {
      const { prompt } = composeLikeProduction("가족 인원 묻기는 이번 주 계획에서 뺄게. 방금 한 가지를 다음에 내가 이어서 알아볼 수 있게만 정리해줘. 공유 할 일에 자동으로 넣지 마.", decisionCount);
      expect(prompt).toContain("급하지 않음·낮은 우선순위는 생략·이번 주 제외가 아닙니다");
      expect(prompt).toContain("말한 항목·기간만 제외하세요");
      expect(prompt).toContain("예단 생략을 모든 가족 선물 생략으로");
    }
  });
  it("예절 태그 지시와 번호표는 함께 남거나 함께 빠진다", () => {
    // 절단은 꼬리부터 통째로 잘라내므로, 번호표가 지시보다 뒤에 있으면
    // **번호↔편 매핑 없이 태그를 붙이라고 시키는 상태**가 생긴다. 잘못된 번호는
    // 화면이 조용히 지워서 사용자에게는 카드가 안 뜬 것으로만 보인다.
    //
    // 결정 개수를 늘려 실제로 절단이 일어나는 구간까지 훑는다.
    let sawBoth = false;
    let sawNeither = false;
    let sawTruncated = false;

    // 예산 운용 지침이 늘어 예절 영역이 먼저 잘리는 경우도 포함하고,
    // 예절을 직접 묻는 실제 도구 구성에서 지시·번호표가 함께 남는 경우도 확인한다.
    for (const userText of ["결혼식 예산 배분 좀 도와줘", "상견례 예절을 알려줘"]) {
      for (let decisions = 0; decisions <= 40; decisions += 2) {
        const { prompt } = composeLikeProduction(userText, decisions);
        const hasInstruction = prompt.includes(ETIQUETTE_TAG_INSTRUCTION);
        const hasTable = prompt.includes(ETIQUETTE_NUMBER_TABLE);

        expect(
          hasInstruction && !hasTable,
          `${userText}, 결정 ${decisions}개: 번호표 없이 태그를 붙이라는 지시만 남았다`,
        ).toBe(false);

        if (hasInstruction && hasTable) sawBoth = true;
        if (!hasInstruction && !hasTable) sawNeither = true;
        if (prompt.includes("길이 제한으로 생략됨")) sawTruncated = true;
      }
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

// 2026-09-14: 아래 규칙들은 원본에서 도구 이름(`update_budget` 등)을 달고 있었다.
// 조립기는 켜지지 않은 도구 이름이 든 줄을 통째로 버리고, 운영은 변경 도구를
// 한 번도 켜지 않는다(route.ts `!isMutatingTool`). 그래서 넷 다 모델에게 간 적이
// 없었는데 원본 grep 은 초록이었다. 여기서는 합성 결과에만 묻는다.
//
// 이름을 뺀 자리에 '도구'라는 낱말은 남긴다. 조립기는 도구가 하나도 없는 턴에서
// '도구'가 든 줄을 따로 걷어내므로(그 결정은 그대로다), 이 규칙들은 조회 도구가
// 하나라도 켜진 턴에만 실리고 W2~W5 같은 도구 0개 갈래에는 실리지 않는다 —
// 이름도 '도구'도 없는 줄은 위로·범위 밖 턴에까지 저장 제안을 시킨다(1차 수정의 구멍).
const TOOL_TURN_RULES = [
  // 총예산 0원 새 커플의 한 건 금액 요청은 인터뷰가 아니라 표식이다(2026-09-06 페르소나).
  "발동하지 않는 경우",
  "총예산이 0원이어도 총액·포함 범위를 묻지 말고 카테고리 예산 도구 표식을 내고",
  "총예산 도구 표식을 먼저 낸 뒤 포함 범위는 그 아래 한 문장으로만 묻습니다",
  // 정확한 예식일은 되짚고 저장 제안, 확인 전 실행·저장 주장 금지.
  "정확한 결혼 예정일을 처음 말하면 그 날짜를 되짚고 저장 제안을 만드세요",
  "확인하기 전에는 예식일 변경을 실행하거나 저장됐다고 말하지 마세요",
  "날짜 인자는 반드시 **오늘(",
  "도구 호출 파라미터는 영어 키 유지",
  "표식의 'category' 파라미터는 반드시 영어 키",
];
// 운영이 켜는 조회 도구 다섯(route.ts 는 `!isMutatingTool` 로 변경 도구를 절대 켜지 않는다).
const PRODUCTION_READ_TOOL_NAMES = [
  "get_budget_summary",
  "get_schedule_summary",
  "get_wedding_info",
  "get_amora_actions",
  "get_market_price",
];
const RULE_UTTERANCES = [
  "드레스 400 잡아줘",
  "총예산 5천으로 해줘",
  "내년 5월 10일에 결혼하기로 했어",
  "12월 3일에 드레스 투어 일정 추가해줘",
  "결혼식 예산 배분 좀 도와줘",
  "상견례 때 뭐 챙겨야 해?",
];

describe("도구 이름 필터가 저자 규칙을 지우지 않는다", () => {
  it.each(RULE_UTTERANCES)("%s: 예산 한 건·예식일·날짜 인자·영어 키 규칙은 조회 도구 유무와 같은 답이다", (userText) => {
    const { prompt, readToolNames } = composeLikeProduction(userText, 0);
    for (const rule of TOOL_TURN_RULES) {
      expect(
        prompt.includes(rule),
        `${userText} (조회 도구 ${readToolNames.length}개): ${rule}`,
      ).toBe(readToolNames.length > 0);
    }
  });

  it("표본에 조회 도구가 켜진 턴이 있다 — 위 단언이 도구 0개 갈래로만 통과한 게 아니다", () => {
    expect(
      RULE_UTTERANCES.some((userText) => composeLikeProduction(userText, 0).readToolNames.length > 0),
    ).toBe(true);
  });

  it("도구 0개 턴에는 여덟 규칙이 전부 빠지고, 운영 조회 도구 다섯이 켜진 턴에는 전부 실린다", () => {
    // 운영 도구 선택에 기대지 않고 두 갈래를 직접 만든다 — 위 it.each 가 우연히
    // 도구 있는 발화만 뽑아도 도구 0개 갈래는 여기서 반드시 한 번 검사된다.
    for (const userText of RULE_UTTERANCES) {
      const withoutTools = composeLikeProduction(userText, 0, []).prompt;
      const withReadTools = composeLikeProduction(userText, 0, PRODUCTION_READ_TOOL_NAMES).prompt;
      for (const rule of TOOL_TURN_RULES) {
        expect(withoutTools, `${userText} (도구 0개): ${rule}`).not.toContain(rule);
        expect(withReadTools, `${userText} (조회 도구 5개): ${rule}`).toContain(rule);
      }
    }
  });

  it("카테고리 키의 출처는 22개 표 하나다 — 표와 어긋나는 10개짜리 목록이 따로 실리지 않는다", () => {
    // `### 카테고리 키` 는 2026-09-03 에 지운 죽은 구간의 **끝** 헤딩이었다. 시작 헤딩만
    // 지워져 홀로 남았고, 조립기의 구간 삭제는 시작을 못 찾으면 아무것도 안 지우므로
    // 매 턴 모델에게 갔다(2026-09-14 프로브 실측) — 위 표 22개와 어긋나는 10개 목록이다.
    for (const userText of RULE_UTTERANCES) {
      const { prompt } = composeLikeProduction(userText, 0, PRODUCTION_READ_TOOL_NAMES);
      expect(prompt).toContain("| 영어 키 | 한글 라벨 |");
      expect(prompt).not.toContain("### 카테고리 키");
      expect(prompt).not.toContain(
        "venue, studio, dress, makeup, ring, hanbok, honeymoon, houseware, invitation, gift",
      );
    }
  });

  it("켜지지 않은 도구 이름은 여전히 기본 프롬프트 구간에 새지 않는다", () => {
    // 필터가 만들어진 이유. 규칙을 살리려고 필터를 느슨하게 한 것이 아님을 고정한다.
    // 도구 계약·제안 계약은 켜진/제안 가능한 도구를 이름으로 부르는 것이 정상이라
    // 그 앞 구간(원본에서 온 부분)만 본다.
    const allToolNames = WEDDING_TOOLS.map((tool) => tool.name);
    let checked = 0;
    for (const userText of RULE_UTTERANCES) {
      const { prompt, readToolNames } = composeLikeProduction(userText, 0);
      const cut = prompt.indexOf("## 현재 실행 가능한 도구 계약");
      if (cut === -1) continue;
      const baseRegion = prompt.slice(0, cut);
      for (const name of allToolNames) {
        if (readToolNames.includes(name)) continue;
        expect(baseRegion, `${userText}: ${name}`).not.toContain(name);
        checked += 1;
      }
    }
    expect(checked, "도구 계약이 실린 턴이 표본에 없다").toBeGreaterThan(0);
  });
});
