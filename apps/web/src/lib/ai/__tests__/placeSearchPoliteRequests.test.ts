import { describe, expect, it } from "vitest";
import { BETA_SAFE_TOOLS } from "../tools";
import { getPlaceSearchToolChoice, isPlaceSearchCandidate } from "../placeSearchRouting";

const REQUEST = "상견례 준비야. 대전역 근처에서 8명이 식사할 곳을 찾고 있어. 휠체어로 들어갈 수 있어야 하고 조용한 방이 있으면 좋겠어. 후보 세 곳을 찾아줄 수 있어? 예약은 하지 마.";
const choice = (userText: string, round = 0, tools = BETA_SAFE_TOOLS) =>
  getPlaceSearchToolChoice({ userText, round, tools });

describe("정중한 장소 검색 부탁도 실제 검색으로 연결한다", () => {
  it.each([
    REQUEST,
    "대전역 근처 부모님 모실 식당 두 곳 찾아줄 수 있나요?",
    "공덕에 상견례 할 곳 찾아주실 수 있나요?",
    "대전역 근처 식당을 검색해 줄 수 있어?",
    "마포에서 식사할 장소를 찾아줄래?",
  ])("장소와 직접 부탁이 있으면 최초 호출에서 검색한다: %s", text => {
    expect(isPlaceSearchCandidate(text)).toBe(true);
    expect(choice(text)).toEqual({ type: "function", name: "search_nearby_places" });
  });

  it.each([
    "대전역 식당 검색하지 마. 찾아줄 수 있냐는 건 예시였어.",
    "대전역에서 식사할 때 할 질문을 만들어줄 수 있어?",
    '“대전역 식당 찾아줄 수 있어?”라는 문장은 어때?',
    "대전역 식당 찾아줄 수 있냐고 친구가 물었어.",
    "대전역 식당 찾아줄 수 있어 라고 친구가 물었어.",
    "대전역 드레스 대여 업체 찾아줄 수 있어?",
  ])("거부·인용·전달·다른 업체 부탁으로 검색을 강제하지 않는다: %s", text => {
    expect(choice(text)).toBeUndefined();
  });

  it("지역이 없으면 먼저 물을 수 있고 기능 미설정이나 후속 라운드에서 강제하지 않는다", () => {
    expect(isPlaceSearchCandidate("부모님 모실 식당을 찾아줄 수 있어?")).toBe(true);
    expect(choice("부모님 모실 식당을 찾아줄 수 있어?")).toBeUndefined();
    expect(choice(REQUEST, 1)).toBeUndefined();
    expect(choice(REQUEST, 0, [])).toBeUndefined();
  });
});
