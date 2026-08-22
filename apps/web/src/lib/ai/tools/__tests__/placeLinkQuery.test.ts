import { describe, expect, it } from "vitest";

import { placeLinkQuery } from "@/lib/ai/tools/placeSearchTools";

/**
 * 카드를 누르면 네이버에서 그 가게가 나와야 한다.
 *
 * 전에는 `이름 + 전체 도로명 주소` 로 검색해서, 검색어가 길어 **결과가 아예 없는**
 * 가게가 있었다(2026-08-23 네이버 실측):
 *
 *     "부엉이산장 강남점 서울특별시 강남구 테헤란로1길 28-11 1층"   0건
 *     "부엉이산장 강남점 강남구"                                  1건
 *     "스타벅스"          → 중구 프레스센터점    (엉뚱한 지역)
 *     "스타벅스 강남구"    → 강남구 코엑스별마당점 (맞는 지역)
 */
describe("placeLinkQuery", () => {
  it("이름에 구를 붙인다", () => {
    expect(placeLinkQuery("부엉이산장 강남점", "서울특별시 강남구 테헤란로1길 28-11 1층"))
      .toBe("부엉이산장 강남점 강남구");
  });

  it("주소 전체를 붙이지 않는다", () => {
    const query = placeLinkQuery("수서역 벌교한상", "서울특별시 강남구 광평로46길 7 수서역벌교한상");
    expect(query).not.toContain("광평로");
    expect(query.split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it.each([
    ["시", "성남시"],
    ["군", "양평군"],
  ])("구가 아니어도 시·군을 쓴다 (%s)", (_label, token) => {
    expect(placeLinkQuery("한상", `경기도 ${token} 어딘가로 1`)).toBe(`한상 ${token}`);
  });

  it("이름에 이미 지역이 있으면 겹쳐 붙이지 않는다", () => {
    expect(placeLinkQuery("강남구 한정식", "서울특별시 강남구 테헤란로 1"))
      .toBe("강남구 한정식");
  });

  it("주소에 구가 없으면 이름만 쓴다", () => {
    expect(placeLinkQuery("한상", "세종특별자치시 어딘가로 1")).toBe("한상");
  });

  it("이름이 비면 주소로 버틴다", () => {
    expect(placeLinkQuery("", "서울특별시 강남구 테헤란로 1"))
      .toBe("서울특별시 강남구 테헤란로 1");
  });
});
