import { describe, expect, it } from "vitest";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { selectAmoraToolsForTurn } from "../toolSelection";

const names = [
  "get_wedding_info",
  "get_schedule_summary",
  "get_schedule_events",
  "get_budget_summary",
  "get_amora_actions",
  "search_vendors",
  "recommend_vendors",
  "get_vendor_detail",
  "check_vendor_availability",
  "get_available_slots",
  "get_my_bookings",
  "get_market_price",
  "analyze_contract_readiness",
  "simulate_guest_guarantee",
  "analyze_quote",
  "create_booking",
];
const tools: AiToolDefinition[] = names.map((name) => ({
  name,
  input_schema: { type: "object" },
}));

describe("selectAmoraToolsForTurn", () => {
  it("keeps a vendor-price turn bounded to the relevant schemas", () => {
    const selected = selectAmoraToolsForTurn(tools, {
      userText: "강남 스튜디오 가격 비교해줘",
    }).map((tool) => tool.name);

    expect(selected).toContain("search_vendors");
    expect(selected).toContain("get_market_price");
    expect(selected).not.toContain("create_booking");
    expect(selected.length).toBeLessThanOrEqual(6);
  });

  it("prioritizes contract tools for an attachment turn", () => {
    const selected = selectAmoraToolsForTurn(tools, {
      userText: "이거 봐줘",
      hasDocumentAttachments: true,
    }).map((tool) => tool.name);

    expect(selected).toEqual([
      "analyze_contract_readiness",
      "analyze_quote",
      "get_market_price",
      "simulate_guest_guarantee",
    ]);
  });

  it("uses a small read-only context set for general conversation", () => {
    expect(selectAmoraToolsForTurn(tools, {
      userText: "오늘 너무 긴장돼요",
    }).map((tool) => tool.name)).toEqual([
      "get_wedding_info",
      "get_schedule_summary",
      "get_budget_summary",
    ]);
  });

  it("does not select unverified availability tools for booking questions", () => {
    const selected = selectAmoraToolsForTurn(tools, {
      userText: "이번 주 토요일 예약 가능한 시간 알려줘",
    }).map((tool) => tool.name);

    expect(selected).toContain("get_my_bookings");
    expect(selected).toContain("get_vendor_detail");
    expect(selected).not.toContain("check_vendor_availability");
    expect(selected).not.toContain("get_available_slots");
  });

  it("uses the previous explicit intent for a short follow-up", () => {
    const selected = selectAmoraToolsForTurn(tools, {
      userText: "그거 자세히 알려줘",
      previousUserText: "강남 스튜디오 후보를 찾아줘",
    }).map((tool) => tool.name);

    expect(selected).toContain("search_vendors");
    expect(selected).not.toContain("get_schedule_events");
  });

  it("does not treat every image or stage-default persona as a contract", () => {
    expect(selectAmoraToolsForTurn(tools, {
      userText: "이 사진 좀 봐줘",
      hasImageAttachments: true,
    }).map((tool) => tool.name)).toEqual(["analyze_quote", "get_market_price"]);

    expect(selectAmoraToolsForTurn(tools, {
      userText: "그거 자세히 알려줘",
    }).map((tool) => tool.name)).toEqual([
      "get_wedding_info",
      "get_schedule_summary",
      "get_budget_summary",
    ]);
  });
});
