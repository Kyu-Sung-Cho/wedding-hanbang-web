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
import {
  buildAmoraPendingActionPrompt,
  extractAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import {
  SERVER_OWNED_UNVERIFIED_NOTICE,
  composeAmoraPersistenceTerminal,
} from "@/lib/ai/amoraPersistenceClaims";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import {
  selectAmoraPendingProposalTools,
  selectAmoraTools,
} from "@/lib/ai/amoraToolPolicy";
import { getAvailableChatTools } from "@/lib/ai/placeSearchRouting";

/**
 * 행동(할 일) 카드가 한 번도 안 나온 이유를 계약문 쪽에서 잠근다.
 *
 * 2026-09-03 스테이징: 예산·단건 일정 카드는 끝까지 되는데 행동 카드와 일정
 * 일괄 등록만 0건이었다. 도구 선택도 서버 검증도 정상이었고, 남은 원인은 계약문
 * 넷이었다 — (1) `add_amora_action` 을 부르며 시키는 문장이 합성 프롬프트 전체에
 * 한 줄도 없음, (2) "모든 입력값이 확정됐을 때만" 을 모델이 선택 필드에까지
 * 적용해 되묻기로 도망감, (3) 표식 형식이 자리표시자 한 줄뿐이라
 * `[ pending_action 필요 ]` 같은 우리말 표식이 나옴, (4) 일괄 규칙이
 * "한 번에 하나만 등록할 수 있어요" 라는 능력 부정으로 옮겨 적힘.
 *
 * **원본이 아니라 합성된 프롬프트에 묻는다.** `prompts.ts` 에는 composer 가 통째로
 * 지우는 죽은 구간이 있어서, 원본을 grep 하면 없는 규칙이 "있다"고 답한다.
 */

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

const PROPOSABLE_TOOLS = PENDING_ACTION_TOOLS.filter(
  (tool) => getAmoraActionApprovalPolicy(tool.name) !== "blocked",
);

const CONTEXT = {
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
  pastConflicts: [],
};

/** 라우트와 같은 순서로 도구를 고르고 같은 인자로 합성한다. */
function composeLikeProduction(userText: string, decisionCount: number): {
  prompt: string;
  contract: string;
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

  const contract = proposableTools.length > 0
    ? buildAmoraPendingActionPrompt(proposableTools)
    : "";
  const prompt = buildAmoraSystemPrompt({ ...CONTEXT, pastDecisions } as never, {
    specialist: "general",
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: readTools.map((tool) => tool.name),
    actionContract: contract ? { kind: "proposal", text: contract } : undefined,
    questionScope,
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  } as never);

  return {
    prompt,
    contract,
    proposableToolNames: proposableTools.map((tool) => tool.name),
  };
}

const TODO_UTTERANCE = "할 일에 청첩장 주문 추가해줘. 마감은 9월 20일이야";
const BUDGET_UTTERANCE = "예산 5000만원으로 잡아줘";
const THREE_EVENT_UTTERANCE =
  "12월 3일 드레스 투어, 12월 10일 스튜디오 촬영, 12월 20일 본식 리허설 세 개 다 일정에 넣어줘";

const ACTION_TOOL_ORDER = "`add_amora_action` 표식을 이번 답변에 내세요";
const FIRST_OF_MANY_NOW = "첫 번째 건의 표식은 이번 답변에 반드시";

/** 필드 목록 줄(`  · 도구명: …`)이 아닌 곳에서 이 도구를 부르는가. */
function namesToolOutsideFieldList(text: string, toolName: string): boolean {
  return text
    .split("\n")
    .some((line) => line.includes(toolName) && !line.trimStart().startsWith("· "));
}

const NOW = 1_789_000_000_000;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";

function extract(text: string) {
  return extractAmoraPendingAction({
    text,
    allowedTools: PROPOSABLE_TOOLS,
    now: NOW,
    createActionId: () => ACTION_ID,
  });
}

describe("행동 카드 계약문", () => {
  it("행동 도구가 열린 턴에만 그 도구를 내라고 시킨다", () => {
    const todo = composeLikeProduction(TODO_UTTERANCE, 0);
    expect(todo.proposableToolNames).toContain("add_amora_action");
    expect(
      todo.prompt.includes(ACTION_TOOL_ORDER),
      "행동 도구가 열렸는데 그 도구를 내라는 문장이 합성 프롬프트에 없다",
    ).toBe(true);

    // 반대 방향. 이 단언이 없으면 "무조건 싣기" 도 통과한다 — 그러면 예산 턴에서
    // 열리지도 않은 도구를 내라고 시키게 된다.
    const budget = composeLikeProduction(BUDGET_UTTERANCE, 0);
    expect(budget.proposableToolNames).not.toContain("add_amora_action");
    expect(
      budget.prompt.includes(ACTION_TOOL_ORDER),
      "행동 도구가 안 열린 턴에 그 도구를 내라는 문장이 실렸다",
    ).toBe(false);
  });

  it("제안 가능한 변경 도구 전수 — 이름이 필드 목록 줄에만 있는 도구를 센다", () => {
    // 필드 목록 줄은 "이 도구에는 이런 칸이 있다"만 말한다. **언제 쓰는지**를
    // 말하는 문장이 어디에도 없으면 모델은 그 도구를 쓸 이유를 배운 적이 없다.
    // 행동 카드가 0건이던 이유가 정확히 이것이었다.
    //
    // 잘리지 않은 프롬프트에 묻는다(절단은 아래 길이 테스트가 따로 본다).
    const questionScope = classifyAmoraQuestionScope({ userText: "결혼 준비 도와줘" });
    const contract = buildAmoraPendingActionPrompt(PROPOSABLE_TOOLS);
    const prompt = buildAmoraSystemPrompt({ ...CONTEXT, pastDecisions: [] } as never, {
      specialist: "general",
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: BETA_SAFE_TOOLS
        .filter((tool) => !isMutatingTool(tool.name))
        .map((tool) => tool.name),
      actionContract: { kind: "proposal", text: contract },
      questionScope,
      maxChars: 400_000,
    } as never);
    expect(prompt).not.toContain("길이 제한으로 생략됨");

    const uncovered = PROPOSABLE_TOOLS
      .filter((tool) => !namesToolOutsideFieldList(prompt, tool.name))
      .map((tool) => tool.name)
      .sort();

    // 남은 공백을 **손으로 적은 목록이 아니라 원장으로** 둔다. 하나라도 늘거나
    // 줄면 여기서 실패하고, 그때 이 목록을 의식적으로 고치게 된다.
    // 2026-09-03 실측값이며, 이 넷은 예산·일정 계열 문장이 다른 이름
    // (`apply_budget_plan`·`add_schedule_event`)으로 같은 자리를 이미 덮고 있다.
    expect(uncovered).toEqual([
      "toggle_checklist_item",
      "update_budget",
      "update_task_status",
      "update_venue",
      "update_wedding_date",
    ]);

    // 이 둘은 **계약문 자체**가 덮어야 한다. 읽기 도구가 무엇이 열렸는지에
    // 기대면, 도구가 제안 가능한데 안내는 없는 턴이 그대로 남는다.
    for (const toolName of ["add_amora_action", "log_wedding_event"] as const) {
      expect(
        namesToolOutsideFieldList(contract, toolName),
        `${toolName}: 계약문이 이 도구를 언제 쓰는지 말하지 않는다`,
      ).toBe(true);
    }
  });

  it("일괄 요청 턴에 '첫 건은 이번 답변에' 가 있고 능력 부정 문구는 없다", () => {
    const { contract, prompt } = composeLikeProduction(THREE_EVENT_UTTERANCE, 0);
    expect(contract).not.toBe("");
    expect(prompt).toContain(FIRST_OF_MANY_NOW);

    // 모델이 옮겨 적은 그 문장이 계약문에서 나온 것처럼 보이면 안 된다.
    // (금지 문구로 인용한 자리 하나만 허용한다 — 그 인용이 곧 금지문이다.)
    const quotedBan = "\"한 번에 하나만 등록할 수 있어요\"처럼 말하지 마세요";
    expect(contract).toContain(quotedBan);
    expect(
      contract.split("한 번에 하나만").length - 1,
      "계약문이 능력 부정 문구를 금지문 밖에서도 말하고 있다",
    ).toBe(1);
  });

  it("길이 — 상한을 넘지 않고, 결정 0건에서는 절단이 없다", () => {
    for (const userText of [TODO_UTTERANCE, BUDGET_UTTERANCE, THREE_EVENT_UTTERANCE]) {
      const zero = composeLikeProduction(userText, 0);
      expect(zero.prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
      expect(
        zero.prompt.includes("길이 제한으로 생략됨"),
        `${userText}: 결정 0건인데 이미 절단됐다`,
      ).toBe(false);

      const twelve = composeLikeProduction(userText, 12);
      expect(twelve.prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
    }
  });

  it("계약문이 수정 전보다 길어지지 않았다", () => {
    // 이번 수정은 계약문에 다섯 줄을 더했다. 그 자리를 만들려고 카테고리 20개
    // 풀이의 반복을 접었는데, **접기가 헛돌아도 나머지 테스트는 전부 초록이다** —
    // 그래서 수정 전 실측 길이를 그대로 박아 둔다. 넘으면 상쇄가 멈춘 것이다.
    // (2026-09-03 수정 직전 실측: 할 일 5712 / 예산 2584 / 일정 3건 4495)
    const before: [string, number][] = [
      [TODO_UTTERANCE, 5712],
      [BUDGET_UTTERANCE, 2584],
      [THREE_EVENT_UTTERANCE, 4495],
    ];
    for (const [userText, baseline] of before) {
      const { contract } = composeLikeProduction(userText, 0);
      expect(
        contract.length,
        `${userText}: 계약문이 ${contract.length}자로 수정 전(${baseline}자)보다 길다`,
      ).toBeLessThanOrEqual(baseline);
    }
  });
});

describe("표식이 버려지는 경로", () => {
  it("우리말로 쓴 근사 표식 — 카드는 없고, 안 됐다는 사실은 알린다", () => {
    const answer = "청첩장 주문을 할 일로 정리해 둘게요.\n[ pending_action 필요 ]";
    const result = extract(answer);

    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(true);
    expect(result.cleanText).not.toContain("pending_action");

    // 라우트가 이 신호로 붙이는 안내. 본문이 중립적이면 지울 거짓 주장이 없어
    // **아무 말도 안 나가는** 것이 원래 동작이었다.
    const terminal = composeAmoraPersistenceTerminal({
      text: result.cleanText,
      toolResults: [],
      hasPendingAction: result.pendingAction !== null,
      persistenceMode: "durable",
      userRequestedChange: true,
      droppedPendingActionTag:
        result.hadPendingActionTag && result.pendingAction === null,
    });
    expect(terminal.text).toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  it("한글 라벨을 넣은 category_key — 카드도 본문도 사라진다", () => {
    // 현재 동작을 그대로 고정한다. 이것이 `category_key` 설명에
    // "한글 라벨은 넣지 마세요" 가 있어야 하는 이유다.
    const result = extract(
      "[pending_action]{\"tool\":\"add_amora_action\",\"input\":{\"title\":\"청첩장 주문\",\"category_key\":\"종이·모바일 초대장\"}}[/pending_action]",
    );
    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(true);
    expect(result.cleanText).toBe("");

    // 같은 요청에 키 값을 쓰면 카드가 난다 — 막는 것은 라벨이지 필드가 아니다.
    const ok = extract(
      "[pending_action]{\"tool\":\"add_amora_action\",\"input\":{\"title\":\"청첩장 주문\",\"category_key\":\"invitation\"}}[/pending_action]",
    );
    expect(ok.pendingAction?.tool).toBe("add_amora_action");
  });

  it("허용 경로 밖의 href — 표식이 통째로 버려진다", () => {
    // 2026-09-03 이전에는 `/wedding/actions` 같은 없는 경로가 그대로 통과해
    // **404 링크가 붙은 카드**가 나갔다. 이제 스키마 enum 이 거른다.
    const invented = extract(
      "[pending_action]{\"tool\":\"add_amora_action\",\"input\":{\"title\":\"청첩장 주문\",\"href\":\"/wedding/actions\"}}[/pending_action]",
    );
    expect(invented.pendingAction).toBeNull();

    const allowed = extract(
      "[pending_action]{\"tool\":\"add_amora_action\",\"input\":{\"title\":\"청첩장 주문\",\"href\":\"/wedding/schedule\"}}[/pending_action]",
    );
    expect(allowed.pendingAction?.input).toMatchObject({ href: "/wedding/schedule" });

    // 생략하면 서버가 화면을 고른다 — 카드가 사라지는 쪽이 아니다.
    const omitted = extract(
      "[pending_action]{\"tool\":\"add_amora_action\",\"input\":{\"title\":\"청첩장 주문\"}}[/pending_action]",
    );
    expect(omitted.pendingAction?.tool).toBe("add_amora_action");
  });

  it("같은 입력에 같은 결과", () => {
    const sample =
      "[pending_action]{\"tool\":\"add_amora_action\",\"input\":{\"title\":\"청첩장 주문\"}}[/pending_action]";
    expect(extract(sample)).toEqual(extract(sample));
    expect(buildAmoraPendingActionPrompt(PROPOSABLE_TOOLS))
      .toBe(buildAmoraPendingActionPrompt(PROPOSABLE_TOOLS));
  });
});
