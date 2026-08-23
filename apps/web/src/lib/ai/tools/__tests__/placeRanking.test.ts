import { describe, expect, it } from "vitest";
import { rankPlacesByQueryKind } from "@/lib/ai/tools/placeSearchTools";

/**
 * "강남 한정식" 에 네이버가 주는 실제 순서(2026-08-23 실측).
 * 우리 검색어는 정확했고 순위가 네이버 것이다.
 */
const NAVER_ORDER = [
  { name: "아쭈", category: "주꾸미요리", categoryFull: "음식점>한식>주꾸미요리" },
  { name: "부엉이산장 강남점", category: "요리주점", categoryFull: "음식점>술집>요리주점" },
  { name: "수서역 벌교한상", category: "한식", categoryFull: "음식점>한식" },
  { name: "수담 한정식 강남점", category: "한정식", categoryFull: "음식점>한식>한정식" },
  { name: "정식당", category: "한식", categoryFull: "음식점>한식" },
];

describe("검색어가 말한 종류를 앞으로", () => {
  it("한정식을 물으면 한정식이 1위, 한식이 주꾸미집보다 앞선다", () => {
    const names = rankPlacesByQueryKind(NAVER_ORDER, "강남 한정식").map((p) => p.name);
    expect(names[0]).toBe("수담 한정식 강남점");
    // "한식" 은 "한정식" 의 부분문자열이 아니라(한-정-식) 상위 갈래로 따로 넣어야 잡힌다.
    expect(names.indexOf("수서역 벌교한상")).toBeLessThan(names.indexOf("아쭈"));
    expect(names.indexOf("정식당")).toBeLessThan(names.indexOf("아쭈"));
  });

  it("하나도 버리지 않는다", () => {
    const ranked = rankPlacesByQueryKind(NAVER_ORDER, "강남 한정식");
    expect(ranked).toHaveLength(NAVER_ORDER.length);
    expect(new Set(ranked.map((p) => p.name)).size).toBe(NAVER_ORDER.length);
  });

  it("종류를 말하지 않으면 네이버 순서를 그대로 둔다", () => {
    const ranked = rankPlacesByQueryKind(NAVER_ORDER, "강남 맛집");
    expect(ranked.map((p) => p.name)).toEqual(NAVER_ORDER.map((p) => p.name));
  });

  it("같은 점수면 네이버 순서를 유지한다", () => {
    const names = rankPlacesByQueryKind(NAVER_ORDER, "강남 한정식").map((p) => p.name);
    expect(names.indexOf("수서역 벌교한상")).toBeLessThan(names.indexOf("정식당"));
  });
});
