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
  "update_wedding_date",
  "update_task_status",
  "update_venue",
  "add_schedule_event",
  "update_schedule_event",
  "delete_schedule_event",
  "toggle_checklist_item",
  "log_wedding_event",
  "search_nearby_places",
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

    expect(selected).not.toContain("search_vendors");
    expect(selected).toContain("get_market_price");
    expect(selected).not.toContain("create_booking");
    expect(selected.length).toBeLessThanOrEqual(6);
  });

  it("does not turn a contract attachment into an appraisal or guest forecast", () => {
    const selected = selectAmoraToolsForTurn(tools, {
      userText: "이거 봐줘",
      hasDocumentAttachments: true,
    }).map((tool) => tool.name);

    expect(selected).toEqual([
      "get_wedding_info",
      "get_schedule_summary",
      "get_budget_summary",
    ]);
    expect(selected).not.toContain("analyze_contract_readiness");
    expect(selected).not.toContain("simulate_guest_guarantee");
    expect(selected).not.toContain("get_market_price");
    expect(selected).not.toContain("analyze_quote");
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

    expect(selected).not.toContain("get_my_bookings");
    expect(selected).not.toContain("get_vendor_detail");
    expect(selected).not.toContain("check_vendor_availability");
    expect(selected).not.toContain("get_available_slots");
  });

  it("uses the previous explicit intent for a short follow-up", () => {
    const selected = selectAmoraToolsForTurn(tools, {
      userText: "그거 자세히 알려줘",
      previousUserText: "강남 스튜디오 후보를 찾아줘",
    }).map((tool) => tool.name);

    expect(selected).not.toContain("search_vendors");
    expect(selected).not.toContain("get_schedule_events");
  });

  it("does not treat every image or stage-default persona as a contract", () => {
    expect(selectAmoraToolsForTurn(tools, {
      userText: "이 사진 좀 봐줘",
      hasImageAttachments: true,
    }).map((tool) => tool.name)).toEqual([
      "get_wedding_info",
      "get_schedule_summary",
      "get_budget_summary",
    ]);

    expect(selectAmoraToolsForTurn(tools, {
      userText: "그거 자세히 알려줘",
    }).map((tool) => tool.name)).toEqual([
      "get_wedding_info",
      "get_schedule_summary",
      "get_budget_summary",
    ]);
  });

  it("never selects the retired quote checklist even when the schema is supplied", () => {
    for (const userText of ["견적 봐줘", "추가금 확인해줘", "예산이 적절한지 알려줘"]) {
      expect(selectAmoraToolsForTurn(tools, { userText }).map((tool) => tool.name))
        .not.toContain("analyze_quote");
    }
  });

  it("never selects retired scoring tools even when a stale caller supplies them", () => {
    const selected = selectAmoraToolsForTurn(tools, {
      userText: "계약서와 보증 인원 봐줘",
      hasDocumentAttachments: true,
    }).map((tool) => tool.name);

    expect(selected).not.toContain("analyze_contract_readiness");
    expect(selected).not.toContain("simulate_guest_guarantee");
  });

  it("never selects retired vendor catalog or booking tools from a stale caller", () => {
    const retiredNames = new Set([
      "search_vendors",
      "recommend_vendors",
      "get_vendor_detail",
      "check_vendor_availability",
      "get_available_slots",
      "create_booking",
      "get_my_bookings",
      "cancel_booking",
    ]);

    for (const userText of [
      "강남 스튜디오 후보 찾아줘",
      "이번 주 토요일 예약 가능한 시간 알려줘",
      "내 예약 취소해줘",
    ]) {
      const selected = selectAmoraToolsForTurn(tools, { userText });
      expect(selected.some((tool) => retiredNames.has(tool.name)), userText).toBe(false);
    }
  });

  it("never selects retired mutation or external place tools from a stale caller", () => {
    const retiredNames = new Set([
      "update_wedding_date",
      "update_task_status",
      "update_venue",
      "add_schedule_event",
      "update_schedule_event",
      "delete_schedule_event",
      "toggle_checklist_item",
      "log_wedding_event",
      "search_nearby_places",
    ]);

    for (const userText of [
      "예식일을 바꿔줘",
      "체크리스트를 완료 처리해줘",
      "강남에서 식당을 찾아줘",
    ]) {
      const selected = selectAmoraToolsForTurn(tools, { userText });
      expect(selected.some((tool) => retiredNames.has(tool.name)), userText).toBe(false);
    }
  });
});
