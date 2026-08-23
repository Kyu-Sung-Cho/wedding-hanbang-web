import { describe, expect, it } from "vitest";

import {
  isExplicitPlaceSearchIntent,
  isPlaceSearchCandidate,
} from "@/lib/ai/placeSearchRouting";

/**
 * 2026-08-23 실측. 사용자가 이렇게 물었다.
 *
 *     사용자: 공덕에 상견례 한정식집 찾아줘
 *     아모라: 공덕의 특정 한정식집을 직접 검색하거나 예약해드리는 기능은 지금 없어요.
 *     사용자: 식당 추천해달라고
 *     아모라: 현재 특정 식당을 검색해 업체명을 확인할 수는 없어서…
 *
 * 아모라는 거짓말하지 않았다. **도구를 아예 못 받았다.** 지역 판정이
 * 하드코딩된 동네 목록이었고 거기 공덕이 없었다. 같은 문장의 "강남" 판은
 * 카드가 나왔다.
 *
 * 동네 이름은 목록으로 관리할 수 없다. 그래서 조사를 본다.
 */

/** 실제로 막혔던 문장들. */
const WAS_BLOCKED = [
  "공덕에 상견례 한정식집 찾아줘",
  "마포에 상견례 식당 찾아줘",
  "합정 근처 상견례 장소 추천해줘",
  "서초에 상견례 한정식집 추천해줘",
  "목동에서 상견례 식당 찾아줘",
] as const;

/** 이미 되던 것. 넓히다가 깨뜨리면 안 된다. */
const ALREADY_WORKED = [
  "강남에서 상견례 할 만한 한정식집 추천해줘",
  "공덕역 근처 한정식집 찾아줘",
  "서울 여의도 근처 맛집 찾아줘",
] as const;

describe("동네 이름을 몰라도 장소 검색이 닿는다", () => {
  it.each(WAS_BLOCKED)("강제 호출까지 간다: %s", (text) => {
    expect(isExplicitPlaceSearchIntent(text)).toBe(true);
    expect(isPlaceSearchCandidate(text)).toBe(true);
  });

  it.each(ALREADY_WORKED)("되던 것은 그대로 된다: %s", (text) => {
    expect(isExplicitPlaceSearchIntent(text)).toBe(true);
  });
});

describe("지역이 없으면 도구는 주되 강제하지는 않는다", () => {
  // 여기서 "어느 동네에서 찾을까요?" 라고 묻는 것은 정당한 되묻기다.
  // "기능이 없어요" 와 다르다 — 사용자는 그 둘을 완전히 다르게 받아들인다.
  it.each([
    "식당 추천해줘",
    "상견례 식당 추천해달라",
    "한정식집 찾아줘",
  ])("도구는 받는다: %s", (text) => {
    expect(isPlaceSearchCandidate(text)).toBe(true);
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
  });
});

describe("장소 검색이 아닌 말은 그대로 걸러진다", () => {
  it.each([
    "상견례 예절 알려줘",
    "웨딩홀 추천해줘",
    "스드메 견적 봐줘",
    "예산 3천만원으로 바꿔줘",
    "9월 25일에 상견례 일정 추가해줘",
  ])("도구를 주지 않는다: %s", (text) => {
    expect(isPlaceSearchCandidate(text)).toBe(false);
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
  });

  it("찾지 말라고 하면 찾지 않는다", () => {
    expect(isPlaceSearchCandidate("공덕 한정식집은 검색하지 마")).toBe(false);
    expect(isExplicitPlaceSearchIntent("공덕 한정식집은 검색하지 마")).toBe(false);
  });

  it("시간을 장소로 읽지 않는다", () => {
    // "주말에" 는 조사가 붙었지만 동네가 아니다. 지역 없는 요청으로 다뤄야 한다.
    expect(isExplicitPlaceSearchIntent("주말에 식당 추천해줘")).toBe(false);
    expect(isExplicitPlaceSearchIntent("다음 주에 식당 찾아줘")).toBe(false);
  });

  it("종류를 가리키는 말이 조사를 달았다고 장소로 읽지 않는다", () => {
    expect(isExplicitPlaceSearchIntent("한정식집에 자리 있는지 추천해줘")).toBe(false);
  });
});
