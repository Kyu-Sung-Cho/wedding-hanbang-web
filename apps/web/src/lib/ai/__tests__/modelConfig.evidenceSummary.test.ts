import { describe, expect, it } from "vitest";
import { chooseAmoraChatModelRole } from "../modelConfig";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "../amoraQuestionScope";
import { selectAmoraTools } from "../amoraToolPolicy";
import { selectPersonalActionConversationTools } from "../amoraPersonalActionConversation";
import { getAvailableChatTools, getPlaceSearchToolChoice, isPlaceSearchCandidate } from "../placeSearchRouting";
import { determineStage, routeSpecialist } from "../stage-router";
import { isMutatingTool } from "../mutationTools";
import { BETA_SAFE_TOOLS } from "../tools";

const readContext = {
  requestKind: "chat",
  durable: true,
  isDemo: false,
  hasPriorityAction: false,
  hasPersonalTools: false,
  hasAttachments: false,
  offersPlaceSearch: false,
  toolNames: ["get_wedding_info"],
};
const separationFollowup = "다음 두 문장은 실제로 일어난 일을 보고하는 게 아니야. “만약 파트너에게 초대장을 모바일로 하자고 말했다면 어떨까?”는 가정이고, “다음 주에 파트너에게 꽃 장식은 줄이고 싶다고 말해볼까”는 아직 검토 중인 말 초안이야. 사진·예산·식후 감사 인사와 이 두 새 항목을 같은 표에 정리하되, 실제 전달 상태와 가정·미래 초안을 섞지 말아줘. 초대장·꽃 장식의 실제 전달 여부는 여기서 밝히지 않았어. 저장하거나 공유하지 마.";
const summary = "결혼 준비에서 확정한 것, 가설인 것, 파트너에게 아직 말하지 않은 것을 구분해서 표로 요약해줘.";
const observedReviewSummary = "사진을 남기고 싶다는 게 전문 촬영을 꼭 하겠다는 뜻은 아니야. 그 점까지 고쳐서, 지금 정한 것과 검토 중인 것만 나눠줘. 저장은 하지 마.";

function roleFor(userText: string, context = readContext, correctionCount = 0) {
  return chooseAmoraChatModelRole({
    specialistType: "general", userText, correctionCount,
    evidenceSummaryContext: context,
  });
}

describe("read-only evidence summary model routing", () => {
  it.each([
    {
      label: "250dcb7d direct item scope",
      text: "결혼 준비 이야기를 정리하고 싶어. 어제 파트너에게 “사진은 꼭 남기고 싶어”라고 직접 말했어. 예산에 대해서는 아직 파트너에게 말 안 했어. 사진 촬영 방식과 예산 금액은 미정이고, 둘이 합의한 내용도 아직 없어. 지금은 내 개인 상담이야. 항목별로 내가 말한 선호, 전달 여부, 합의 여부를 구분해서 표로 정리해줘. 저장하거나 공유하지 마.",
      expectedScope: "W0_wedding_core",
      expectedReads: ["analyze_quote", "get_amora_actions", "get_budget_summary", "get_market_price", "get_schedule_events", "get_schedule_summary", "get_wedding_info", "simulate_guest_guarantee"],
    },
    // 초대장·꽃 장식의 전달 상태 요약에는 다른 분야 공시 조회를 열지 않는다.
    { label: "958 future draft separation", text: separationFollowup, expectedScope: "W4_out_of_scope", expectedReads: [] },
    { label: "P07 current decision and review", text: observedReviewSummary, expectedScope: "W4_out_of_scope", expectedReads: [] },
  ])("selects primary with the actual production tool catalog: $label", ({ text, expectedReads, expectedScope }) => {
    const scope = classifyAmoraQuestionScope({ userText: text });
    const specialistType = routeSpecialist(text, determineStage(null));
    const candidates = getAvailableChatTools({ requestKind: "chat", isDurableUserMessageBound: true, tools: BETA_SAFE_TOOLS });
    const reads = filterAmoraToolsByQuestionScope(selectAmoraTools({
      availableTools: candidates, userText: text, specialistType, attachmentKind: "none", checklistLabels: [],
    }).filter(tool => !isMutatingTool(tool.name)), scope);
    const personal = selectPersonalActionConversationTools({
      tools: candidates, userText: text, visibility: "bride_private", requestKind: "chat", durable: true, scope,
    });
    const offersPlaceSearch = getPlaceSearchToolChoice({ userText: text, round: 0, tools: candidates }) !== undefined || isPlaceSearchCandidate(text);
    expect(scope.scope).toBe(expectedScope);
    expect(personal).toEqual([]);
    expect(offersPlaceSearch).toBe(false);
    expect(reads.map(tool => tool.name).sort()).toEqual(expectedReads);
    expect(roleFor(text, { ...readContext, toolNames: reads.map(tool => tool.name), offersPlaceSearch, hasPersonalTools: personal.length > 0 })).toBe("primary");
  });

  it.each([
    summary,
    observedReviewSummary,
    "지금 정한 내용과 검토 중인 부분을 나눠 주세요.",
    "정한 것과 아직 검토 중인 것을 구분해줘. 저장하거나 공유하지 마.",
    separationFollowup,
    "실제 전달과 가정의 상태를 표에 정리하되 섞지 말아 주세요.",
    "확정과 미정의 상태를 혼동하지 말아줘.",
    "항목별 선호, 전달 여부, 합의 여부를 구분해서 표로 정리해줘. 저장하거나 공유하지 마.",
    "확정과 미정인 부분을 요약해 주세요.",
    "내가 확정한 내용과 아직 가설인 내용을 정리해 줄래?",
    "‘예산은 아직 미정이야’라고 직접 말했어. 전달 여부와 합의 여부를 구분해 주세요.",
  ])("selects primary for a direct multi-state summary: %s", text => {
    expect(roleFor(text)).toBe("primary");
  });

  it("permits an empty read-tool list without enabling tools", () => {
    expect(roleFor(summary, { ...readContext, toolNames: [] })).toBe("primary");
  });

  it.each([
    "정한 것과 검토 중인 것을 나눠주지 마.",
    "‘정한 것과 검토 중인 것을 나눠줘.’라는 문장을 번역해줘.",
    "정한 것과 검토 중인 것을 나눠줘라는 말이 무슨 뜻이야?",
    "정한 것과 검토 중인 것을 나눠줘. 저장해줘.",
    "정한 것과 검토 중인 것을 나눠줘. 저장은 하지 마. 대신 일정에 추가해줘.",
    "정한 것과 검토 중인 것은 나중에 보고 오늘 준비 순서만 나눠줘.",
    "결혼 준비 순서를 표로 정리해줘.",
    "확정과 미정 이야기는 끝이야. 두 물감을 섞지 말아줘.",
    "확정과 미정 상태를 섞지 말아줘라는 문장을 설명해줘.",
    "‘확정과 미정 상태를 섞지 말아줘.’라는 부탁을 번역해줘.",
    "확정과 미정 상태를 혼동하지 말아줘. 예산은 저장해줘.",

    "미정과 합의 이야기는 여기까지야. 오늘은 결혼 준비 순서를 정리해줘.",
    "확정과 미정은 나중에 보고, 오늘 결혼 준비 순서만 정리해줘.",
    "확정한 예산을 설명해줘.",
    "미정과 합의의 차이는 뭐야?",
    "미정인 것과 합의한 내용을 정리하지 마.",
    "미정인 것과 합의한 내용을 정리해주지 마.",
    "만약 미정과 합의를 요약한다면 어떨까?",
    "\"미정과 합의를 표로 요약해줘.\"라는 문장을 번역해줘.",
    "“미정과 합의를 표로 요약해줘.”라고 파트너가 말했어.",
    "`미정과 합의를 요약해줘.`의 맞춤법을 봐줘.",
    "> 미정과 합의를 요약해줘.\n위 문장을 다듬어줘.",
    "```text\n미정과 합의를 요약해줘.\n```\n이 예문을 설명해줘.",
    "예문: 미정과 합의를 요약해줘.",
    "미정과 합의를 요약해줘라는 표현이 무슨 뜻이야?",
    "미정과 합의를 요약해 줘 라는 표현이 무슨 뜻이야?",
    '"미정과 합의를\n표로 요약해줘.\n"라는 문장을 설명해줘.',
    "미정과 합의를 요약해줘. 예산을 저장해줘.",
    "미정과 합의를 요약해줘. 내 할 일에 추가해줘.",
    "예산을 반영하고 미정과 합의를 요약해줘.",
    "미정과 합의를 요약해줘. 저장하지 마. 대신 일정은 등록해줘.",
  ])("keeps ordinary, quoted, negated and mixed write turns on the existing route: %s", text => {
    expect(roleFor(text)).toBe("fast");
  });

  it.each([
    { requestKind: "initial_greeting" },
    { requestKind: "mediation" },
    { durable: false },
    { isDemo: true },
    { hasPriorityAction: true },
    { hasPersonalTools: true },
    { hasAttachments: true },
    { offersPlaceSearch: true },
    { toolNames: ["get_personal_actions"] },
    { toolNames: ["get_wedding_info", "search_nearby_places"] },
    { toolNames: ["get_wedding_info", "apply_budget_plan"] },
    { toolNames: ["get_wedding_info", "future_read_tool"] },
  ])("does not change the existing action or external-context route: %j", override => {
    expect(roleFor(summary, { ...readContext, ...override })).toBe("fast");
    expect(roleFor(separationFollowup, { ...readContext, ...override })).toBe("fast");
    expect(roleFor(observedReviewSummary, { ...readContext, ...override })).toBe("fast");
  });

  it("requires a server context and preserves crisis/correction priority", () => {
    expect(chooseAmoraChatModelRole({ specialistType: "general", userText: summary, correctionCount: 0 })).toBe("fast");
    expect(roleFor(summary, { ...readContext, hasPriorityAction: true }, 2)).toBe("primary");
    expect(roleFor("상대가 협박하고 있어", { ...readContext, hasPriorityAction: true })).toBe("primary");
  });

  it("keeps ordinary or mixed-write requests fast even with all production summary reads", () => {
    const context = { ...readContext, toolNames: ["get_wedding_info", "get_budget_summary", "get_schedule_summary",
      "get_amora_actions", "get_schedule_events", "get_market_price", "simulate_guest_guarantee", "analyze_quote"] };
    expect(roleFor("결혼 준비 순서를 정리해줘.", context)).toBe("fast");
    expect(roleFor("확정과 미정을 정리해줘. 예산을 저장해줘.", context)).toBe("fast");
  });
});
