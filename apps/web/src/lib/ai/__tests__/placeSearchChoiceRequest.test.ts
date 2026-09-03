import { describe, expect, it } from "vitest";

import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import {
  getPlaceSearchToolChoice,
  isPlaceSearchCandidate,
  PLACE_SEARCH_TOOL_NAME,
} from "@/lib/ai/placeSearchRouting";

/**
 * 2026-09-03 (2차 Turn 24 실측).
 *
 *   사용자: 식당 예식, 일반 컨벤션 예식, 제주 가족식 세 안 중 … 1순위로 골라줘
 *   화면:   [빨간 카드] 장소 검색을 완료하지 못했어요.
 *           웨딩 업체 검색은 검수된 공시가 탐색을 이용해주세요.
 *
 * `식당` + `골라 줘` + `제주` 가 모두 걸려 강제 호출(tool_choice)이 붙었고, 모델은
 * 답을 쓰기 전에 네이버 검색부터 불러야 했다. 사용자가 원한 것은 검색이 아니라
 * 판단이었다.
 *
 * 고치는 것은 **강제뿐**이다 — 도구를 빼면 "그런 기능 없어요" 회귀가 난다.
 */

const tools: AiToolDefinition[] = [
  {
    name: PLACE_SEARCH_TOOL_NAME,
    description: "장소 검색",
    parameters: { type: "object", properties: {} },
  } as unknown as AiToolDefinition,
];

const forced = (userText: string) =>
  getPlaceSearchToolChoice({ userText, round: 0, tools }) !== undefined;

/** 안을 늘어놓고 고르라는 말. 강제하면 안 된다. */
const 선택을_요구하는_문장 = [
  "식당 예식, 일반 컨벤션 예식, 제주 가족식 세 안 중에 1순위로 골라줘",
  "제주 식당 두 곳 중 하나만 골라줘",
  "대전 한정식집 셋 중 어디가 좋을까",
  "강남 상견례 식당 3개 중에 하나 추천해줘",
  "서울 상견례 식당 후보 셋 중 1순위 알려줘",
] as const;

/** 안이 없는 진짜 검색 요청. 강제는 그대로 남아야 한다. */
const 검색을_요구하는_문장 = [
  "강남 상견례 식당 찾아줘",
  "공덕에 상견례 한정식집 찾아줘",
  "제주 가족식 하기 좋은 식당 골라줘",
  "서울 여의도 근처 맛집 찾아줘",
  "마포에 괜찮은 한정식집 알려줘",
] as const;

describe("선택·판단을 요구하면 장소 검색을 강제하지 않는다", () => {
  it.each(선택을_요구하는_문장)("강제하지 않는다: %s", (text) => {
    expect(forced(text)).toBe(false);
  });

  it.each(선택을_요구하는_문장)("그래도 도구는 준다: %s", (text) => {
    // route.ts 의 `offersPlaceSearch` 는 이 판정으로 도구를 목록에 남긴다.
    // 강제만 풀고 도구를 빼지 않으므로 "기능이 없다" 회귀가 생기지 않는다.
    expect(isPlaceSearchCandidate(text)).toBe(true);
  });
});

describe("대조군 — 안이 없는 검색 요청은 그대로 강제된다", () => {
  it.each(검색을_요구하는_문장)("강제한다: %s", (text) => {
    expect(forced(text)).toEqual(true);
  });

  it("강제할 때는 장소 검색 도구를 지목한다", () => {
    expect(getPlaceSearchToolChoice({
      userText: "강남 상견례 식당 찾아줘",
      round: 0,
      tools,
    })).toEqual({ type: "function", name: PLACE_SEARCH_TOOL_NAME });
  });

  it("두 번째 라운드부터는 원래도 강제하지 않는다", () => {
    expect(getPlaceSearchToolChoice({
      userText: "강남 상견례 식당 찾아줘",
      round: 1,
      tools,
    })).toBeUndefined();
  });
});
