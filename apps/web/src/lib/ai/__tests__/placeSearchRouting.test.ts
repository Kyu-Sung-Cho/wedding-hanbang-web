import { describe, expect, it } from "vitest";
import type { AiToolDefinition } from "../toolDefinition";
import {
  getAvailableChatTools,
  getPlaceSearchToolChoice,
  isExplicitPlaceSearchIntent,
  PLACE_SEARCH_TOOL_NAME,
} from "../placeSearchRouting";

const tools: AiToolDefinition[] = [
  {
    name: PLACE_SEARCH_TOOL_NAME,
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "update_budget",
    input_schema: {
      type: "object",
      properties: { total_budget: { type: "number" } },
      required: ["total_budget"],
    },
  },
];

describe("place search routing", () => {
  it.each([
    "강남 상견례식당 찾아줘",
    "강남역 근처 한정식 맛집 추천해 주세요",
    "홍대 카페 검색해봐",
    "부산에서 상견례 장소 어디가 좋아?",
  ])("detects explicit place lookup intent: %s", (text) => {
    expect(isExplicitPlaceSearchIntent(text)).toBe(true);
  });

  it.each([
    "상견례 예절 알려줘",
    "강남 웨딩홀 추천해줘",
    "상견례 장소 어디가 좋아?",
    "식당은 검색하지 마",
    "오늘 뭐 먹을까?",
  ])("does not force unrelated or negated requests: %s", (text) => {
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
  });

  it("keeps only the read-only place tool for unbound demo or legacy turns", () => {
    expect(getAvailableChatTools({
      requestKind: "chat",
      isDurableUserMessageBound: false,
      tools,
    }).map((tool) => tool.name)).toEqual([PLACE_SEARCH_TOOL_NAME]);
  });

  it("keeps the full safe tool set for a durable chat turn", () => {
    expect(getAvailableChatTools({
      requestKind: "chat",
      isDurableUserMessageBound: true,
      tools,
    })).toEqual(tools);
  });

  it("disables all tools outside normal chat turns", () => {
    expect(getAvailableChatTools({
      requestKind: "mediation",
      isDurableUserMessageBound: true,
      tools,
    })).toEqual([]);
  });

  it("forces the NAVER place tool only on the first round", () => {
    expect(getPlaceSearchToolChoice({
      userText: "강남 상견례 식당 찾아줘",
      round: 0,
      tools,
    })).toEqual({ type: "function", name: PLACE_SEARCH_TOOL_NAME });
    expect(getPlaceSearchToolChoice({
      userText: "강남 상견례 식당 찾아줘",
      round: 1,
      tools,
    })).toBeUndefined();
  });
});
