import { describe, expect, it } from "vitest";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import {
  AMORA_TOOL_POLICY_NAMES,
  selectAmoraPendingProposalTools,
  selectAmoraPendingProposalToolsWithCarryover,
  selectAmoraTools,
} from "@/lib/ai/amoraToolPolicy";

function names(userText: string, specialistType: Parameters<typeof selectAmoraTools>[0]["specialistType"] = "general") {
  return selectAmoraTools({
    availableTools: BETA_SAFE_TOOLS,
    userText,
    specialistType,
  }).map((tool) => tool.name);
}

describe("selectAmoraTools", () => {
  it("keeps every configured policy name inside the beta-safe registry", () => {
    const safeNames = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    expect([...AMORA_TOOL_POLICY_NAMES].filter((name) => !safeNames.has(name))).toEqual([]);
  });

  it("keeps a small stable read-only baseline for general conversation", () => {
    const selected = names("요즘 준비가 막막해");
    expect(selected).toEqual([
      "get_budget_summary",
      "get_schedule_summary",
      "get_wedding_info",
      "get_amora_actions",
    ]);
    expect(selected.length).toBeLessThan(BETA_SAFE_TOOLS.length);
  });

  it("adds budget reads without mutations for an informational question", () => {
    const selected = names("스드메 견적 시세가 적당한지 알려줘", "budget_optimizer");
    expect(selected).toEqual(expect.arrayContaining([
      "get_budget_summary",
      "get_market_price",
      "simulate_guest_guarantee",
    ]));
    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("apply_budget_plan");
  });

  it("keeps local-place and vendor discovery outside the focused MVP", () => {
    for (const query of [
      "강남역 근처 상견례 식당 찾아줘",
      "강남 근처 웨딩 스튜디오 찾아줘",
      "서울 근처 결혼식장 찾아줘",
      "근처 결혼 준비 업체 찾아줘",
      "근처 혼주 메이크업 찾아줘",
      "근처 웨딩 촬영 업체 찾아줘",
      "근처 웨딩 사진 업체 찾아줘",
      "근처 본식 업체 찾아줘",
      "근처 예식 업체 찾아줘",
    ]) {
      expect(names(query)).not.toContain("search_nearby_places");
    }
  });

  it("does not expose marketplace or booking tools in the current MVP", () => {
    const safeNames = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    for (const retiredName of [
      "search_vendors",
      "check_vendor_availability",
      "recommend_vendors",
      "get_vendor_detail",
      "get_available_slots",
      "create_booking",
      "get_my_bookings",
      "cancel_booking",
      "search_nearby_places",
    ]) {
      expect(safeNames.has(retiredName)).toBe(false);
    }
  });

  it("unlocks only matching mutations when write intent is explicit", () => {
    const selected = names("총 예산을 4천만원으로 변경해줘", "budget_optimizer");
    expect(selected).toContain("update_budget");
    expect(selected).not.toContain("update_category_budget");
    expect(selected).not.toContain("apply_budget_plan");
    expect(selected).not.toContain("add_custom_category");
    expect(selected).not.toContain("add_schedule_event");
    expect(selected).not.toContain("update_venue");
  });

  it.each([
    ["예산은 3천만 원이야", "update_budget"],
    ["드레스 예산은 250만 원이야", "update_category_budget"],
    ["드레스에 250만 원 썼어", "update_category_budget"],
    ["내년 5월 5일에 결혼해", "update_wedding_date"],
    ["토요일에 상견례야", "add_schedule_event"],
    ["예식장 계약했어", "update_task_status"],
  ])("treats a concrete first-person declaration as an executable %s intent", (text, toolName) => {
    expect(names(text)).toContain(toolName);
  });

  it.each([
    "친구는 예산이 3천만 원이래",
    "예산을 3천만 원으로 하면 어떨까?",
    "토요일에 상견례를 하면 좋을까?",
    "내년 5월 5일 결혼식은 어때?",
  ])("does not turn third-party or hypothetical language into a mutation: %s", (text) => {
    const selected = names(text);
    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("update_wedding_date");
    expect(selected).not.toContain("add_schedule_event");
    expect(selected).not.toContain("update_task_status");
  });

  it("does not treat read-oriented check or help wording as mutation consent", () => {
    for (const text of [
      "내 예산 체크해줘",
      "드레스 견적 비교해줘",
      "일정 좀 정리해줘",
      "체크리스트 보여줘",
    ]) {
      const selected = names(text, "general");
      expect(selected).not.toContain("update_budget");
      expect(selected).not.toContain("update_category_budget");
      expect(selected).not.toContain("add_schedule_event");
      expect(selected).not.toContain("toggle_checklist_item");
    }
  });

  it("exposes only the requested budget mutation family", () => {
    expect(names("드레스 예산을 250만원으로 변경해줘")).toContain("update_category_budget");
    expect(names("드레스 예산을 250만원으로 변경해줘")).not.toContain("update_budget");

    expect(names("이 예산 배분 계획을 그대로 적용해줘")).toContain("apply_budget_plan");
    expect(names("이 예산 배분 계획을 그대로 적용해줘")).not.toContain("update_budget");

    expect(names("포토부스 예산 카테고리를 추가해줘")).toContain("add_custom_category");
    expect(names("포토부스 예산 카테고리를 추가해줘")).not.toContain("apply_budget_plan");
  });

  it("routes document review to contract tools without destructive booking tools", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "이 파일 검토해줘",
      specialistType: "general",
      attachmentKind: "document",
    }).map((tool) => tool.name);
    expect(selected).toEqual(expect.arrayContaining([
      "analyze_contract_readiness",
      "analyze_quote",
      "get_market_price",
    ]));
    expect(selected).not.toContain("create_booking");
    expect(selected).not.toContain("cancel_booking");
    expect(selected).not.toContain("delete_schedule_event");
  });

  it("scopes pending proposals to the current domain instead of exposing every mutation", () => {
    const budget = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "예산을 어떻게 나누면 좋을까?",
      specialistType: "budget_optimizer",
    }).map((tool) => tool.name);
    expect(budget).toEqual(expect.arrayContaining([
      "update_budget",
      "update_category_budget",
      "apply_budget_plan",
    ]));
    expect(budget).not.toContain("add_schedule_event");
    expect(budget).not.toContain("update_venue");

    const general = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "요즘 준비가 막막해",
      specialistType: "general",
    });
    expect(general).toEqual([]);
  });

  it("does not authorize a mutation from assistant prose and a generic approval", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 그렇게 해줘",
      specialistType: "general",
      routingContext: [{
        role: "assistant",
        content: "총 예산을 4천만원으로 변경해드릴까요?",
      }],
    }).map((tool) => tool.name);

    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("add_schedule_event");
  });

  it("does not turn a generic approval into a write from unrelated context", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 해줘",
      specialistType: "general",
      routingContext: [{
        role: "assistant",
        content: "현재 예산은 4천만원이고 다음 일정은 드레스 투어예요.",
      }],
    }).map((tool) => tool.name);

    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("add_schedule_event");
    expect(selected).not.toContain("update_venue");
  });

  it("does not let a specialist read hint authorize a generic write", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 해줘",
      specialistType: "budget_optimizer",
    }).map((tool) => tool.name);

    expect(selected).toContain("get_budget_summary");
    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("apply_budget_plan");
  });

  it("does not inherit an old proposal when it is not the immediate previous turn", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 그렇게 해줘",
      specialistType: "general",
      routingContext: [
        { role: "assistant", content: "예산을 4천만원으로 바꿔드릴까요?" },
        { role: "user", content: "그런데 오늘 날씨는 어때?" },
      ],
    }).map((tool) => tool.name);

    expect(selected).not.toContain("update_budget");
  });
});

describe("selectAmoraPendingProposalToolsWithCarryover", () => {
  const proposal = (userText: string, previousUserText: string | null) =>
    selectAmoraPendingProposalToolsWithCarryover({
      availableTools: BETA_SAFE_TOOLS,
      userText,
      previousUserText,
      specialistType: "general",
    }).map((tool) => tool.name);

  it("keeps the current-turn selection when the last turn carries domain intent", () => {
    expect(proposal("총예산 4천만원으로 바꿔줘", null)).toContain("update_budget");
  });

  it("carries the proposal window from the previous user turn on a generic consent", () => {
    // "응, 해줘"는 도메인 어휘가 없어 자체로는 제안 0개 — 직전 턴에서 이월돼야
    // 모델이 pending 표식을 낼 수 있고, 확인 버튼 플로우가 이어진다.
    expect(proposal("응 맞아, 그대로 적용해줘", null)).toEqual([]);
    expect(proposal("응 맞아, 그대로 적용해줘", "총예산 4천만원으로 바꿔줘"))
      .toContain("update_budget");
  });

  it("never widens beyond what the previous turn itself would allow", () => {
    expect(proposal("응 좋아", "오늘 날씨 어때?")).toEqual([]);
  });
});

describe("한국어 복합 금액 표기", () => {
  // 결혼 예산은 "3천5백만원"·"1억5천만원"처럼 단위를 겹쳐 말하는 쪽이 더 흔하다.
  // 숫자 하나에 단위 하나만 받던 시절 "총예산 4천2백만원으로 바꿔줘"가 확정
  // 발화로 인식되지 않아, 아모라가 "예산을 수정할 수 없다"고 답했다
  // (2026-07-25 실계정 전체 여정 E2E에서 발견).
  it.each([
    "우리 총예산 4천2백만원으로 바꿔줘",
    "예산 3천5백만원이야",
    "예산 1억5천만원으로 정했어",
    "총예산 4천만원이야",
    "예산 3500만원이야",
  ])("확정 발화로 인식해 예산 확인 카드를 낼 수 있다: %s", (userText) => {
    const tools = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText,
      specialistType: "general",
    }).map((tool) => tool.name);
    expect(tools).toContain("update_budget");
  });

  it("금액이 없는 예산 잡담까지 확인 카드를 내지는 않는다", () => {
    const tools = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "예산 얘기는 나중에 하자",
      specialistType: "general",
    }).map((tool) => tool.name);
    expect(tools).not.toContain("update_schedule_event");
  });

  it.each([
    "스튜디오 3백2십만원 결제했어",
    "예식장 1억2천만원으로 정했어",
  ])("카테고리 금액도 복합 표기를 받는다: %s", (userText) => {
    const tools = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText,
      specialistType: "general",
    }).map((tool) => tool.name);
    expect(tools).toContain("update_category_budget");
  });
});
