import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "../amoraQuestionScope";
import { getPersonalActionDraftToolChoice, hasExplicitPersonalActionDraftRequest, PERSONAL_ACTION_CONVERSATION_TOOLS, personalActionConversationConsent, selectPersonalActionConversationTools } from "../amoraPersonalActionConversation";
import { buildAmoraSystemPrompt } from "../amoraPromptComposer";

const ACTUAL = '나만 볼 개인 할 일 초안을 하나 만들어줘. 제목은 "사진에서 꼭 남기고 싶은 장면 세 가지 정리"로 해줘. 설명에는 나만 볼 생각을 메모한다는 내용을 담아줘. 마감일은 정하지 않았어. 개인 할 일 저장 전에 내가 검토할 수 있게 초안을 보여줘.';
const classify = (userText: string) => classifyAmoraQuestionScope({ userText, requestKind: "chat", hasTrustedPrivateDraftContext: true });
const toolsFor = (userText: string, visibility = "bride_private", durable = true, requestKind = "chat") => selectPersonalActionConversationTools({
  tools: PERSONAL_ACTION_CONVERSATION_TOOLS, userText, visibility, durable, requestKind, scope: classify(userText),
});

describe("explicit personal draft product routing", () => {
  it("keeps the original single normalization boundary for separated Hangul jamo", () => {
    expect(classify("\u1102\u200D\u1161의 할 일로 담을 초안만 줘").scope).toBe("W4_out_of_scope");
  });
  it.each([ACTUAL, "내 개인 할 일 초안을 만들어줘"])("does not widen scope without trusted private context: %s", userText => {
    expect(classifyAmoraQuestionScope({ userText, requestKind: "chat" }).scope).toBe("W4_out_of_scope");
    expect(classifyAmoraQuestionScope({ userText, requestKind: "chat", hasTrustedPrivateDraftContext: false }).scope).toBe("W4_out_of_scope");
  });
  it.each([
    ACTUAL,
    "내 개인 할 일 초안을 만들어줘",
    "저만 보는 할 일 초안을 준비해줘. 제목은 '내가 남기고 싶은 모습 정리'야.",
    "나의 할 일로 담을 초안만 줘",
  ])("offers the real draft tool without inventing a wedding keyword: %s", text => {
    expect(hasExplicitPersonalActionDraftRequest(text)).toBe(true);
    expect(personalActionConversationConsent(text).draft).toBe(true);
    expect(classify(text)).toMatchObject({ scope: "W0_wedding_core", allowsLongTermMemory: false });
    expect(toolsFor(text).map(tool => tool.name)).toContain("prepare_personal_action");
  });

  it.each([
    "내 개인 할 일 초안을 만들지 마. 지금은 대화만 할게",
    "내 개인 할 일 초안을 준비해주지 마. 지금은 대화만 할게",
    "내 개인 할 일 초안을 만들어 달라고 하면 어떻게 돼?",
    "내 개인 할 일은 나중에 볼게. 게임 공략 초안을 만들어줘.",
    "내 개인 할 일은 나중에 보고, 게임 공략 초안을 만들어줘.",
    "```text\n내 개인 할 일 초안을 만들어줘\n```\n이 문장 뜻을 설명해줘",
    "상대방 개인 할 일 초안을 만들어줘",
    "친구의 개인 할 일 초안을 만들어줘",
    "내 개인 할 일 초안은 아직 저장하지 않았어. 지금까지 이야기만 정리해줘",
    '친구가 "내 개인 할 일 초안을 만들어줘"라고 말했어. 무슨 뜻일까?',
    "사진에서 남기고 싶은 장면을 정리해줘",
    "내 개인 할 일 초안으로 회사 발표 자료를 만들어줘",
    "내 개인 할 일 초안을 만들어줘. 운동 시간을 정리할 거야",
    "내 개인 할 일 초안으로 강아지 훈련 계획을 만들어줘",
    "내 개인 할 일 초안으로 Python 숙제를 작성해줘",
  ])("does not turn a refusal, other owner, quotation or outside task into a product draft: %s", text => {
    expect(classify(text).scope).toBe("W4_out_of_scope");
    expect(toolsFor(text)).toEqual([]);
  });

  it.each([
    ["내 개인 할 일 초안을 만들어줘. 너무 지쳤어", "W3_social_care"],
    ["내 개인 할 일 초안을 만들어줘. 약 복용량을 정해줘", "W2_high_risk_adjacent"],
    ["내 개인 할 일 초안을 만들어줘. 지금 죽고 싶어", "W5_safety_override"],
  ])("keeps the earlier care/safety lane: %s", (text, scope) => {
    expect(classify(text).scope).toBe(scope);
    expect(toolsFor(text)).toEqual([]);
  });

  it.each([
    ["shared", true, "chat"], ["bride_private", false, "chat"],
    ["bride_private", true, "initial_greeting"], ["bride_private", true, "mediation"],
  ] as const)("does not open a personal capability in %s/%s/%s", (visibility, durable, requestKind) => {
    expect(toolsFor(ACTUAL, visibility, durable, requestKind)).toEqual([]);
  });

  it("keeps the no-save draft contract in the actual composed prompt within 48k", () => {
    const scope = classify(ACTUAL);
    const offered = toolsFor(ACTUAL);
    const prompt = buildAmoraSystemPrompt({ weddingDate: null, budget: 0, venue: null, progress: {}, preparationStatus: null,
      brideName: "본인", groomName: "함께 준비하는 사람", senderName: "본인", bookings: [], scheduleEvents: [], chatSummaries: [], pastConflicts: [], pastDecisions: [] }, {
      requestKind: "chat", persistenceMode: "durable", questionScope: scope,
      enabledToolNames: offered.map(tool => tool.name), maxChars: 48_000,
    });
    expect(prompt).toContain("prepare_personal_action으로 초안을 내세요");
    expect(prompt).toContain("초안은 저장이 아니며 답변 아래 확인창에서 저장합니다");
    expect(prompt.length).toBeLessThanOrEqual(48_000);
  });
});

describe("explicit titled personal draft invocation", () => {
  const specified = '내 개인 할 일 초안을 만들어줘. 제목은 "내가 메모할 준비 기준"로 해줘.';
  const choice = (userText: string, round = 0, tools = toolsFor(userText)) =>
    getPersonalActionDraftToolChoice({ userText, round, tools });

  it.each([
    ACTUAL,
    specified,
    '내 개인 할 일 초안을 만들어줘. 제목은 "내 준비 기준"으로 해줘.',
    "저만 보는 할 일 초안을 준비해줘. 제목은 '내가 남기고 싶은 모습 정리'로 해주세요.",
  ])("requires only the offered draft for a current specified title: %s", text => {
    expect(choice(text)).toEqual({ type: "function", name: "prepare_personal_action" });
  });

  it.each([1, 2])("does not force another draft in round %s", round => {
    expect(choice(ACTUAL, round)).toBeUndefined();
  });

  it("does not create a capability that was not offered", () => {
    expect(choice(ACTUAL, 0, [])).toBeUndefined();
    expect(choice(ACTUAL, 0, PERSONAL_ACTION_CONVERSATION_TOOLS.filter(tool => tool.name === "get_personal_actions"))).toBeUndefined();
  });

  it.each([
    "내 개인 할 일 초안을 만들어줘",
    '내 개인 할 일 초안을 만들어줘. 제목은 ""로 해줘.',
    '내 개인 할 일 초안을 만들어줘. 제목은 "   "로 해줘.',
    '내 개인 할 일 초안을 만들어줘. 만약 제목은 "내 메모"로 해줘.',
    '내 개인 할 일 초안을 만들어줘. 제목은 "내 메모"로 하면 어떨까?',
    '내 개인 할 일 초안을 만들어줘. 제목은 "내 메모"로 해줘?',
    '내 개인 할 일 초안을 만들어줘. 친구의 제목은 "친구 메모"로 해줘.',
    '내 개인 할 일 초안을 만들어줘. 친구가 "메모. 제목은 \'타인의 일\'로 해줘."라고 했어.',
    '내 개인 할 일 초안을 만들어줘. 친구가 "메모. 내 개인 할 일 초안을 만들어줘. 제목은 \'타인의 일\'로 해줘."라고 했어.',
    '내 개인 할 일 초안을 만들어줘.\n> 친구의 메모. 제목은 \'타인의 일\'로 해줘.',
    '내 개인 할 일 초안을 만들어줘. 그리고 친구에게 보낼 축하 카드도 써줘. 제목은 "축하해"로 해줘.',
  ])("leaves an unspecified or unconfirmed title to the ordinary response: %s", text => {
    expect(hasExplicitPersonalActionDraftRequest(text)).toBe(true);
    expect(choice(text)).toBeUndefined();
  });

  it.each([
    '결혼 준비 중 친구가 "내 개인 할 일 초안을 만들어줘"라고 했어. 제목은 "준비 메모"로 해줘.',
    '결혼 준비 중 내 개인 할 일 초안을 만들어 달라고 하면 어떻게 돼? 제목은 "준비 메모"로 해줘.',
    '내 개인 할 일 초안을 준비해주지 마. 제목은 "준비 메모"로 해줘.',
    '내 개인 할 일은 나중에 보고, 게임 공략 초안을 만들어줘. 제목은 "준비 메모"로 해줘.',
    '```text\n내 개인 할 일 초안을 만들어줘\n```\n제목은 "준비 메모"로 해줘.',
    '상대방 개인 할 일 초안을 만들어줘. 제목은 "준비 메모"로 해줘.',
  ])("does not force from broad consent or a quoted draft even when a tool is supplied: %s", text => {
    expect(hasExplicitPersonalActionDraftRequest(text)).toBe(false);
    expect(choice(text, 0, PERSONAL_ACTION_CONVERSATION_TOOLS)).toBeUndefined();
  });

  it.each([
    ["shared", true, "chat"], ["bride_private", false, "chat"],
    ["bride_private", true, "initial_greeting"], ["bride_private", true, "mediation"],
  ] as const)("keeps the existing capability ceiling in %s/%s/%s", (visibility, durable, requestKind) => {
    expect(choice(ACTUAL, 0, toolsFor(ACTUAL, visibility, durable, requestKind))).toBeUndefined();
  });

  it.each(["너무 지쳤어", "약 복용량을 정해줘", "지금 죽고 싶어"])("does not force through the earlier care/safety lane: %s", suffix => {
    expect(choice(`${specified} ${suffix}`)).toBeUndefined();
  });
});
