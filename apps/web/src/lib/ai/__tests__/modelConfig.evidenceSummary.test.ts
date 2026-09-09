import { describe, expect, it } from "vitest";
import { chooseAmoraChatModelRole } from "../modelConfig";

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
const summary = "결혼 준비에서 확정한 것, 가설인 것, 파트너에게 아직 말하지 않은 것을 구분해서 표로 요약해줘.";

function roleFor(userText: string, context = readContext, correctionCount = 0) {
  return chooseAmoraChatModelRole({
    specialistType: "general", userText, correctionCount,
    evidenceSummaryContext: context,
  });
}

describe("read-only evidence summary model routing", () => {
  it.each([
    summary,
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
    "결혼 준비 순서를 표로 정리해줘.",
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
  ])("does not change the existing action or external-context route: %j", override => {
    expect(roleFor(summary, { ...readContext, ...override })).toBe("fast");
  });

  it("requires a server context and preserves crisis/correction priority", () => {
    expect(chooseAmoraChatModelRole({ specialistType: "general", userText: summary, correctionCount: 0 })).toBe("fast");
    expect(roleFor(summary, { ...readContext, hasPriorityAction: true }, 2)).toBe("primary");
    expect(roleFor("상대가 협박하고 있어", { ...readContext, hasPriorityAction: true })).toBe("primary");
  });
});
