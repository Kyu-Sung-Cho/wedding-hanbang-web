import { describe, expect, it } from "vitest";

import { shortenPlaceQuery } from "@/lib/ai/tools/placeSearchTools";

/**
 * 모델은 사용자 말투를 그대로 검색어로 옮긴다. 네이버 지역 검색은 키워드로
 * 찾으므로 그런 검색어에는 결과를 하나도 주지 않는다.
 *
 * 2026-08-22 네이버에 직접 물어 잰 값:
 *
 *     "강남역 근처 상견례 하기 좋은 한정식 식당"   items 0
 *     "강남역 상견례 한정식"                      items 5
 *     "식사동 양쪽 부모님 모임 식당"               items 0
 *     "식사동 식당"                               items 5
 *     "서초 조용한 룸 있는 한식당"                 items 0
 *     "서초 한식당"                               items 5
 *
 * 도구 설명에도 짧게 쓰라고 적었지만 그것만 믿지 않는다. 첫 시도가 비면 서버가
 * 스스로 줄여 한 번 더 찾는다.
 */
describe("shortenPlaceQuery", () => {
  it.each([
    "강남역 근처 상견례 하기 좋은 한정식 식당",
    "서초 조용한 룸 있는 한식당",
    "식사동 양쪽 부모님 모임 식당",
  ])("말하듯 쓴 검색어를 낱말 3개 이하로 줄인다: %s", (input) => {
    const shortened = shortenPlaceQuery(input);
    expect(shortened).not.toBeNull();
    expect(shortened!.split(/\s+/).length).toBeLessThanOrEqual(3);
    // 지역은 앞, 종류는 뒤 — 한국어 장소 검색어의 보통 모양을 지킨다.
    const original = input.split(/\s+/);
    expect(shortened!.startsWith(original[0])).toBe(true);
    expect(shortened!.endsWith(original[original.length - 1])).toBe(true);
  });

  it("지역과 종류는 남는다", () => {
    const shortened = shortenPlaceQuery("식사동 양쪽 부모님 모임 식당");
    expect(shortened).not.toBeNull();
    expect(shortened!.startsWith("식사동")).toBe(true);
    expect(shortened!.endsWith("식당")).toBe(true);
    expect(shortened!.split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it.each([
    "강남역 한정식",
    "홍대 카페",
    "서초 한식당",
    "강남역 근처 한식",
  ])("이미 짧으면 다시 찾지 않는다: %s", (query) => {
    expect(shortenPlaceQuery(query)).toBeNull();
  });

  it("줄여도 같은 말이면 다시 찾지 않는다", () => {
    // 꾸밈말이 하나도 없어 줄여도 그대로인 경우.
    expect(shortenPlaceQuery("강남 한정식")).toBeNull();
  });

  it("남는 말이 너무 짧으면 포기한다", () => {
    expect(shortenPlaceQuery("근처 좋은 곳 데 좀")).toBeNull();
  });
});
