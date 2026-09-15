import { describe, expect, it } from "vitest";

import { applyAmoraOutputHygiene } from "../amoraOutputHygiene";
import {
  composeAmoraPersistenceTerminal,
  isExplicitAmoraChangeRequest,
  SERVER_OWNED_EMPTY_ANSWER_NOTICE,
} from "../amoraPersistenceClaims";
import {
  AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE,
  appendAmoraPrivateLaneSharedChangeGuidance,
  assessAmoraPrivateLaneSharedChangeTurn,
  classifyPrivateLaneChangeTurnShape,
  stripAmoraPrivateLaneSharedChangeOffers,
  type AssessAmoraPrivateLaneSharedChangeInput,
} from "../amoraPrivateLaneSharedChange";
import { buildAmoraSystemPrompt } from "../amoraPromptComposer";
import type { AmoraQuestionScopeClassification } from "../amoraQuestionScope";
import { selectAmoraTools } from "../amoraToolPolicy";
import { isMutatingTool } from "../mutationTools";
import { BETA_SAFE_TOOLS } from "../tools";

/**
 * 2026-09-15 운영 재현(‘나만 (상담)’):
 *   "총예산 5천만 원으로 바꿔줘" → "총예산을 5,000만 원으로 변경할까요?" (카드 없음)
 *   "응 그렇게 바꿔줘"          → "이 대화에서는 예산을 직접 저장하는 기능이 없어…"
 *   "그럼 남은 예산은?"          → 반영 안 된 5,000만 원을 총예산으로 계산
 *
 * 판정은 라우트가 쓰는 도구 선택 함수를 **그대로** 태워 본다. 입력 모양도 라우트와 같다.
 */
const W0: AmoraQuestionScopeClassification = {
  scope: "W0_wedding_core",
  allowsLongTermMemory: true,
  confidence: "high",
  needsClarification: false,
};
const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function assess(
  userText: string,
  overrides: Partial<AssessAmoraPrivateLaneSharedChangeInput> = {},
  toolIntentText = userText,
) {
  const specialistType = "budget_optimizer" as const;
  return assessAmoraPrivateLaneSharedChangeTurn({
    visibility: "bride_private",
    requestKind: "chat",
    isDemo: false,
    durable: true,
    questionScope: W0,
    userText,
    hasPersonalActionTools: false,
    selectedTools: selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: toolIntentText,
      specialistType,
    }),
    proposalSelection: {
      availableTools: PENDING_ACTION_TOOLS,
      userText: toolIntentText,
      specialistType,
      specialistMatchedByKeyword: true,
    },
    ...overrides,
  });
}

describe("개인 레인의 공유 변경 부탁 판정", () => {
  it("변경 부탁만 있는 턴은 서버 안내 대상이다", () => {
    const turn = assess("총예산 5천만 원으로 바꿔줘");
    expect(turn?.kind).toBe("change_only");
    expect(turn?.toolNames.some((name) => name === "update_budget" || name === "update_category_budget")).toBe(true);
  });

  it("말로 한 동의도 연속성으로 붙은 앞 문장이 공유 변경이면 같은 안내를 받는다", () => {
    expect(assess("응 그렇게 바꿔줘", {}, "총예산 5천만 원으로 바꿔줘\n응 그렇게 바꿔줘")?.kind).toBe("change_only");
    expect(assess("응 그렇게 해줘", {}, "총예산 5천만 원으로 바꿔줘\n응 그렇게 해줘")?.kind).toBe("change_only");
    // 앞 문장이 없으면 무엇을 바꿀지 모르는 동의다 — 도구 신호가 없어 판정하지 않는다.
    expect(assess("응 그렇게 해줘")).toBeNull();
  });

  it("일정·체크리스트 변경 부탁도 같은 판정을 받는다", () => {
    expect(assess("상견례 일정 10월 5일로 옮겨줘")?.kind).toBe("change_only");
  });

  it("질문이 섞이면 mixed 다", () => {
    expect(assess("총예산 5천만 원으로 바꿔줘. 그럼 남은 예산은 얼마야?")?.kind).toBe("mixed");
    expect(classifyPrivateLaneChangeTurnShape("총예산 5천만 원으로 바꿔주고 식대는 얼마까지 되는지 알려줘")).toBe("mixed");
    expect(classifyPrivateLaneChangeTurnShape("부모님이 오천까지 도와주신다고 하셨어. 총예산 5천만 원으로 바꿔줘")).toBe("mixed");
  });

  it("첨부 분석·장소 검색이 함께 있는 턴은 모델 답을 버리지 않는다", () => {
    expect(assess("총예산 5천만 원으로 바꿔줘", { hasOtherWork: true })?.kind).toBe("mixed");
  });

  it("부탁 말투의 물음표는 질문으로 보지 않는다", () => {
    expect(classifyPrivateLaneChangeTurnShape("총예산 5천만 원으로 바꿔줄래?")).toBe("change_only");
    expect(classifyPrivateLaneChangeTurnShape("총예산 5천만 원으로 바꿔줘. 부탁해!")).toBe("change_only");
  });

  it("읽기 질문·가정 질문은 변경 부탁이 아니다", () => {
    expect(assess("그럼 남은 예산은?")).toBeNull();
    expect(assess("총예산을 5천만 원으로 변경하면 어때?")).toBeNull();
  });

  it("공유 레인·체험·개인 할 일 요청·범위 밖 턴은 판정하지 않는다", () => {
    expect(assess("총예산 5천만 원으로 바꿔줘", { visibility: "shared" })).toBeNull();
    expect(assess("총예산 5천만 원으로 바꿔줘", { isDemo: true })).toBeNull();
    expect(assess("총예산 5천만 원으로 바꿔줘", { durable: false })).toBeNull();
    expect(assess("총예산 5천만 원으로 바꿔줘", { hasPersonalActionTools: true })).toBeNull();
    expect(assess("총예산 5천만 원으로 바꿔줘", {
      questionScope: { ...W0, scope: "W4_out_of_scope", allowsLongTermMemory: false },
    })).toBeNull();
    // W1 은 공유 레인에서도 카드 도구가 열리지 않는다 — "함께 대화에서 카드로" 가 거짓이 된다.
    expect(assess("총예산 5천만 원으로 바꿔줘", { questionScope: { ...W0, scope: "W1_wedding_adjacent" } })).toBeNull();
  });

  it("공유 할 일(기억·메모) 부탁은 이 안내 대상이 아니다", () => {
    // 발화는 부탁 모양이지만 도구 선택이 고른 쓰기 도구는 공유 할 일(`add_amora_action`)뿐이다.
    expect(selectAmoraTools({ availableTools: BETA_SAFE_TOOLS, userText: "드레스 투어 할 일 추가해줘", specialistType: "budget_optimizer" })
      .map((tool) => tool.name)).toContain("add_amora_action");
    expect(assess("드레스 투어 할 일 추가해줘")).toBeNull();
  });
});

describe("mixed 턴의 모델 답 정리", () => {
  it("적용 여부를 묻는 문장과 기능 부정을 걷고 답은 남긴다", () => {
    const result = stripAmoraPrivateLaneSharedChangeOffers(
      "지금 저장된 총예산은 3,250만 원이라 남은 예산은 1,200만 원이에요. 총예산을 5,000만 원으로 변경할까요? 이 대화에서는 예산을 직접 저장하는 기능이 없어요.",
    );
    expect(result.text).toBe("지금 저장된 총예산은 3,250만 원이라 남은 예산은 1,200만 원이에요.");
    expect(result.removedCount).toBe(2);
  });

  it("함께 대화 이동 안내는 서버 안내와 겹치므로 걷는다", () => {
    const result = stripAmoraPrivateLaneSharedChangeOffers(
      "식대는 1인 6만 원 안팎이 무난해요.\n\n함께 대화 탭에서 예산 변경을 요청해 주세요.",
    );
    expect(result.text).toBe("식대는 1인 6만 원 안팎이 무난해요.");
  });

  it("공유 기록을 가리키지 않는 상담 질문은 남긴다", () => {
    const text = "어떤 항목부터 줄일까요? 우선순위를 먼저 정해 보면 좋아요.";
    expect(stripAmoraPrivateLaneSharedChangeOffers(text)).toEqual({ text, removedCount: 0 });
  });

  it("모델 답이 비거나 빈 답 안내로 바뀌었으면 안내만 낸다", () => {
    expect(appendAmoraPrivateLaneSharedChangeGuidance("")).toBe(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE);
    expect(appendAmoraPrivateLaneSharedChangeGuidance(SERVER_OWNED_EMPTY_ANSWER_NOTICE)).toBe(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE);
    expect(appendAmoraPrivateLaneSharedChangeGuidance("답이에요.")).toBe(`답이에요.\n\n${AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE}`);
    expect(appendAmoraPrivateLaneSharedChangeGuidance(`답이에요.\n\n${AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE}`))
      .toBe(`답이에요.\n\n${AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE}`);
  });
});

describe("서버 안내 문구", () => {
  it("라우트의 위생·거짓 저장 주장 검사를 지나도 한 글자도 바뀌지 않는다", () => {
    const userText = "총예산 5천만 원으로 바꿔줘";
    const hygiene = applyAmoraOutputHygiene(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE, { userText });
    expect(hygiene.text).toBe(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE);
    const guarded = composeAmoraPersistenceTerminal({
      text: hygiene.text,
      toolResults: [],
      hasPendingAction: false,
      hasEmittedPendingAction: false,
      persistenceMode: "durable",
      demoUserText: userText,
      userRequestedChange: false,
      userTurnIsChangeRequest: isExplicitAmoraChangeRequest(userText),
      droppedPendingActionTag: false,
    });
    expect(guarded.text).toBe(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE);
    expect(guarded.removedClaimCount).toBe(0);
  });

  it("화면의 탭 이름을 쓰고, 상대방에게 보인다는 사실과 미반영을 함께 말한다", () => {
    expect(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE).toContain("‘나만 (상담)’");
    expect(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE).toContain("‘함께 대화’ 탭");
    expect(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE).toContain("반영하지 않았어요");
    expect(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE).toContain("상대방에게도 보여요");
    expect(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE).not.toMatch(/플래너|파트너|베타|사전등록|죄송/u);
  });
});

describe("개인 레인 프롬프트", () => {
  const context = {
    weddingDate: null,
    budget: 32_500_000,
    venue: null,
    progress: {},
    brideName: null,
    groomName: null,
    senderName: "사용자",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
  };
  const compose = (conversationLane: "shared" | "private" | undefined, maxChars?: number) =>
    buildAmoraSystemPrompt({ ...context }, {
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: ["get_wedding_info", "get_budget_summary"],
      questionScope: W0,
      ...(conversationLane ? { conversationLane } : {}),
      ...(maxChars ? { maxChars } : {}),
    } as Parameters<typeof buildAmoraSystemPrompt>[1]);

  it.each([undefined, 48_000])("카드·적용 확인 흐름을 지시하지 않고 미반영 값을 현재 값으로 쓰지 않게 한다 (maxChars=%s)", (maxChars) => {
    const prompt = compose("private", maxChars);
    expect(prompt).not.toContain("변경 대상을 물어 확인 카드로 좁히세요");
    expect(prompt).not.toContain("사용자가 명시적으로 적용을 확인한 뒤");
    expect(prompt).not.toContain("어디서 직접 입력할 수 있는지 한 곳만 안내하세요");
    expect(prompt).toContain("[나만 (상담) 변경 경계]");
    expect(prompt).toContain("\"변경할까요?\"·\"반영할까요?\"처럼 적용 여부를 묻거나 진행을 약속하지 마세요");
    expect(prompt).toContain("사용자가 바꿔 달라고 했지만 반영되지 않은 값은 현재 값이 아닙니다");
    expect(prompt).toContain("‘함께 대화’ 탭에서 같은 요청을 보내면 확인 카드로 반영할 수 있다고 안내하세요");
    // 계약은 꼬리 맨 끝에 있어 앞의 공유 레인용 문장보다 뒤에 읽힌다.
    expect(prompt.trimEnd().endsWith("가정임을 밝히세요.")).toBe(true);
  });

  it("공유 레인은 기존 확인 카드 지시를 그대로 받는다", () => {
    for (const lane of [undefined, "shared"] as const) {
      const prompt = compose(lane, 48_000);
      expect(prompt).toContain("기능 부정 대신 변경 대상을 물어 확인 카드로 좁히세요");
      expect(prompt).toContain("사용자가 명시적으로 적용을 확인한 뒤");
      expect(prompt).not.toContain("[나만 (상담) 변경 경계]");
    }
  });
});
