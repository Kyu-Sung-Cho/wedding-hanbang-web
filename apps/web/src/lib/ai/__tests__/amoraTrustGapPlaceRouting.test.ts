import { describe, expect, it } from "vitest";
import { BETA_SAFE_TOOLS } from "../tools";
import { getPlaceSearchToolChoice, isExplicitPlaceSearchIntent, isPlaceSearchCandidate } from "../placeSearchRouting";

function expectNoPlaceSearch(text: string): void {
  expect(isPlaceSearchCandidate(text)).toBe(false);
  expect(isExplicitPlaceSearchIntent(text)).toBe(false);
  expect(getPlaceSearchToolChoice({ userText: text, round: 0, tools: BETA_SAFE_TOOLS })).toBeUndefined();
}

describe("추천 거절은 검색 카드로 뒤집지 않는다", () => {
  it("추천 말고 다른 도움을 원하면 검색하지 않는다", () => {
    expectNoPlaceSearch("강남 식당 추천 말고 상견례 예절만 알려줘.");
  });

  it("추천은 됐다는 정정에도 검색하지 않는다", () => {
    expectNoPlaceSearch("강남 식당 추천은 됐고 예절만 알려줘.");
  });

  it("추천을 원하지 않는다는 뜻도 보존한다", () => {
    expectNoPlaceSearch("강남 식당 추천을 원하지 않아. 예절만 알려줘.");
  });

  it("추천해달라는 게 아니라는 정정에도 검색하지 않는다", () => {
    expectNoPlaceSearch("강남 식당 추천해달라는 게 아니야. 예절만 알려줘.");
  });

  it("추천은 됐어라는 정정에도 검색하지 않는다", () => {
    expectNoPlaceSearch("강남 식당 추천은 됐어. 예절만 알려줘.");
  });

  it("추천받고 싶지 않다는 거절에도 검색하지 않는다", () => {
    expectNoPlaceSearch("강남 식당은 추천받고 싶지 않아. 답장만 써줘.");
  });

  it("추천 받기 싫다는 거절에도 검색하지 않는다", () => {
    expectNoPlaceSearch("강남 식당 추천 받기 싫어. 예절만 알려줘.");
  });

  it("추천은 하지 말라는 명시적인 거절을 보존한다", () => {
    expectNoPlaceSearch("강남 상견례 식당 추천은 하지 말아줘. 대화 주제만 알려줘.");
  });

  it.each([
    "강남 상견례 식당 추천 안 해도 돼. 대화 주제만 알려줘.",
    "강남 상견례 식당은 찾지 말고 부모님께 드릴 말만 알려줘.",
    "강남 상견례 식당을 물어본 게 아니야. 예절만 알려줘.",
    "강남 상견례 식당 추천 필요 없어. 무엇을 이야기할지 알려줘.",
    "강남 상견례 식당은 이미 정했어. 추천하지 말아 주세요.",
  ])("거절·정정의 다른 어형도 보존한다: %s", expectNoPlaceSearch);
});

describe("인용한 부탁과 현재 부탁을 분리한다", () => {
  it("찾아달라고 했다는 전언에는 검색하지 않는다", () => {
    expectNoPlaceSearch("엄마가 강남 식당 찾아달라고 했어요. 답장 문구만 알려줘.");
  });

  it("추천해달래라는 간접 부탁에는 검색하지 않는다", () => {
    expectNoPlaceSearch("엄마가 강남 식당 추천해달래. 답장 문구만 알려줘.");
  });

  it("높임말 전언의 답장 부탁에는 검색하지 않는다", () => {
    expectNoPlaceSearch("부모님이 강남 식당 추천해 달라고 하셨는데 답장을 도와줘.");
  });

  it("부모님이 찾아달라 하셨다는 전언에도 검색하지 않는다", () => {
    expectNoPlaceSearch("엄마가 강남 식당을 찾아달라 하셨어. 답장 문구만 알려줘.");
  });

  it("줄래라고 물은 친구의 말을 현재 검색 부탁으로 읽지 않는다", () => {
    expectNoPlaceSearch("친구가 강남 식당 추천해줄래라고 물었어. 답장만 써줘.");
  });

  it("어디 있냐고 물었다는 전언에도 검색하지 않는다", () => {
    expectNoPlaceSearch("친구가 강남 카페가 어디 있냐고 물었어. 답장 문구만 작성해줘.");
  });

  it("추천해줄 수 있다는 인용 질문에도 검색하지 않는다", () => {
    expectNoPlaceSearch('엄마가 "강남 식당 추천해줄 수 있어요?"라고 물었어. 답장만 써줘.');
  });

  it("부탁하셨다는 전언도 본인의 검색 요청이 아니다", () => {
    expectNoPlaceSearch("엄마가 강남 식당 추천해달라고 부탁하셨어. 답장만 써줘.");
  });

  it("추천해줄 수 있냐고 물었다는 전언에도 검색하지 않는다", () => {
    expectNoPlaceSearch("엄마가 강남 식당 추천해줄 수 있냐고 물었어. 답장만 써줘.");
  });

  it.each([
    "엄마가 강남 상견례 식당 추천해줘라고 했는데, 아직 장소를 고를 생각은 없어. 엄마에게 답장 문구만 알려줘.",
    "엄마가 “강남 상견례 식당 추천해줘”라고 했어. 엄마께 보낼 답장만 알려줘.",
    "엄마가 강남 식당 추천해달라고 했어요. 뭐라고 답하지?",
    "엄마가 강남 식당 추천해줘라며 부탁했어요. 답장만 작성해줘.",
  ])("다른 사람이 요청했다는 말에 검색하지 않는다: %s", expectNoPlaceSearch);
});

describe("식당이 질문의 배경인 경우 검색하지 않는다", () => {
  it.each([
    "강남 상견례 식당 메뉴를 부모님께 어떻게 설명하면 좋을까?",
    "강남 상견례 식당 비용만 알려줘. 장소 목록 말고.",
  ])("메뉴 설명·비용 질문에 다른 식당을 추천하지 않는다: %s", expectNoPlaceSearch);
});

describe("거절·인용과 별개의 직접 요청은 보존한다", () => {
  it.each([
    "강남 상견례 식당 찾아줘",
    "공덕에 상견례 한정식집 찾아줘",
    "대화 주제는 말고 강남 상견례 식당 찾아줘",
    "상견례 예절도 알려주고 공덕에 한정식집도 찾아줘.",
    "강남 식당은 추천하지 말고 공덕에 카페 찾아줘.",
    "엄마가 “강남 상견례 식당 추천해줘”라고 했어. 나는 공덕에 카페 찾아줘.",
    "강남 상견례 식당 비용도 알려주고 공덕에 식당도 찾아줘.",
  ])("현재 사용자가 직접 부탁한 곳을 검색한다: %s", (text) => {
    expect(isPlaceSearchCandidate(text)).toBe(true);
    expect(isExplicitPlaceSearchIntent(text)).toBe(true);
    expect(getPlaceSearchToolChoice({ userText: text, round: 0, tools: BETA_SAFE_TOOLS }))
      .toEqual({ type: "function", name: "search_nearby_places" });
  });

  it.each([
    "상견례 식당 추천해줘",
    "엄마가 “강남 상견례 식당 추천해줘”라고 했어. 나는 상견례 식당 찾아줘.",
    "카페 찾아줘, 엄마가 강남 식당 추천해달라고 했어.",
  ])("인용한 지역을 현재 요청에 빌리지 않는다: %s", (text) => {
    expect(isPlaceSearchCandidate(text)).toBe(true);
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
    expect(getPlaceSearchToolChoice({ userText: text, round: 0, tools: BETA_SAFE_TOOLS })).toBeUndefined();
  });

  it.each([
    "강남 상견례 식당 찾아줘. 아니 검색하지 마. 대화 주제만 알려줘.",
    "강남 상견례 식당은 추천하지 마. 대화 주제만 알려줘.",
    "엄마가 “강남 상견례 식당 찾아줄 수 있어요?”라고 했어. 답장 문구만 알려줘.",
    "상견례와 결혼식은 각각 어떤 자리인지 두 문장으로 알려줘.",
    "강남 한정식집에서 부모님께 어디까지 결혼 계획을 말할지 질문 세 가지만 알려줘.",
  ])("비추천 통제 및 전역 취소를 유지한다: %s", expectNoPlaceSearch);
});
