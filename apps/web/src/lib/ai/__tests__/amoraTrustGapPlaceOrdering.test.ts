import { describe, expect, it } from "vitest";
import { BETA_SAFE_TOOLS } from "../tools";
import { getPlaceSearchToolChoice, isExplicitPlaceSearchIntent, isPlaceSearchCandidate } from "../placeSearchRouting";

function routeResult(text: string) {
  return {
    candidate: isPlaceSearchCandidate(text),
    explicit: isExplicitPlaceSearchIntent(text),
    toolChoice: getPlaceSearchToolChoice({ userText: text, round: 0, tools: BETA_SAFE_TOOLS }),
  };
}

describe("현재 검색 부탁과 전언의 순서가 달라도 직접 부탁을 보존한다", () => {
  it.each([
    "공덕에 카페 찾아줘, 엄마가 강남 상견례 식당 추천해줘라고 했어.",
    "공덕에 카페 찾아줘 그리고 엄마가 강남 상견례 식당 추천해줘라고 했어.",
    "엄마가 강남 상견례 식당 추천해줘라고 했어, 나는 공덕에 카페 찾아줘.",
    "엄마가 강남 상견례 식당 추천해줘라고 했어 그리고 나는 공덕에 카페 찾아줘.",
    "공덕에 카페 찾아줘. 엄마가 강남 상견례 식당 추천해줘라고 했어.",
    "공덕에 카페 찾아줘 그런데 엄마가 강남 상견례 식당 추천해줘라고 했어.",
    "공덕에 카페 찾아줘 하지만 친구는 강남 식당 추천해줘라고 했어.",
    "공덕 카페 찾아줘, 엄마가 강남 식당 추천해달라고 했어.",
    "엄마가 강남 식당 추천해달라고 했어. 나는 공덕 카페 찾아줘.",
  ])("현재 부탁을 전언에 덮어쓰지 않는다: %s", (text) => {
    expect(routeResult(text)).toEqual({
      candidate: true,
      explicit: true,
      toolChoice: { type: "function", name: "search_nearby_places" },
    });
  });

  it.each([
    "엄마가 강남 상견례 식당 추천해줘라고 했어. 답장 문구만 알려줘.",
    "공덕에 카페 찾아줘. 아니 검색하지 마. 답장 문구만 알려줘.",
    "엄마가 강남 식당 찾아줘, 카페 추천해줘라고 했어. 답장 문구만 알려줘.",
    "엄마가 강남 식당 찾아줘 그리고 카페 추천해줘라고 했어. 답장 문구만 알려줘.",
  ])("전언만 있는 경우와 전체 취소는 닫힌 상태다: %s", (text) => {
    expect(routeResult(text)).toEqual({ candidate: false, explicit: false, toolChoice: undefined });
  });
  it("never borrows the reported speaker's location for an unlocated current request", () => {
    expect(routeResult("카페 찾아줘, 엄마가 강남 식당 추천해줘라고 했어.")).toEqual({ candidate: true, explicit: false, toolChoice: undefined });
  });
});
