// @vitest-environment node

/**
 * 도구가 실제로 **가까운 순**으로 돌려주는가.
 *
 * `placeDistance` 의 순수 로직은 따로 검사한다. 여기서는 네이버를 가짜로 세워
 * `executeSearchNearbyPlaces` 전체 경로를 돌린다 — 배선이 빠지면 순수 로직이
 * 아무리 맞아도 화면은 그대로다.
 *
 * ## 무엇이 있었나
 *
 * "강남역 근처 상견례 하기 좋은 한정식집" 의 1번이 서초대로73길(교대·서초역 쪽)이었다.
 * 검색이 `sort=comment`(리뷰 수 많은 순) 하나만 썼기 때문이다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GANGNAM = { x: "1270276662", y: "374979340" };
const naver = (lon: number, lat: number) => ({
  mapx: String(Math.round(lon * 10_000_000)),
  mapy: String(Math.round(lat * 10_000_000)),
});

const NEAR = { title: "가까운집", address: "서울 강남구", roadAddress: "서울 강남구", category: "한식>한정식", ...naver(127.028, 37.4982) };
const FAR = { title: "먼집", address: "서울 서초구", roadAddress: "서울 서초구", category: "한식>한정식", ...naver(127.0146, 37.4936) };
const ANCHOR = { title: "강남역", address: "서울 강남구", mapx: GANGNAM.x, mapy: GANGNAM.y };

const calls = vi.hoisted(() => ({ urls: [] as string[], anchorFails: false }));

beforeEach(() => {
  vi.resetModules();
  calls.urls = [];
  calls.anchorFails = false;
  process.env.NAVER_API_HUB_CLIENT_ID = "test-id";
  process.env.NAVER_API_HUB_CLIENT_SECRET = "test-secret";

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.urls.push(url);
    const params = new URL(url).searchParams;
    const query = params.get("query") ?? "";
    const body = (items: unknown[]) => ({
      ok: true,
      status: 200,
      json: async () => ({ items }),
    }) as unknown as Response;

    if (url.includes("/search/v1/image")) return body([]);
    // 기준점 조회
    if (query === "강남역") {
      if (calls.anchorFails) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      return body([ANCHOR]);
    }
    // 리뷰 많은 순은 먼 집을 먼저 준다 — 이것이 실제로 있었던 모양이다.
    if (params.get("sort") === "comment") return body([FAR, NEAR]);
    return body([NEAR]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NAVER_API_HUB_CLIENT_ID;
  delete process.env.NAVER_API_HUB_CLIENT_SECRET;
});

async function search(query: string) {
  const { executeSearchNearbyPlaces } = await import("@/lib/ai/tools/placeSearchTools");
  return executeSearchNearbyPlaces({ query });
}

describe("가까운 순으로 돌려준다", () => {
  it("리뷰 많은 순이 먼 집을 먼저 줘도 가까운 집이 1번이 된다", async () => {
    const result = await search("강남역 한정식");
    const places = (result.toolOutput as { places: Array<{ name: string }> }).places;
    expect(places[0].name).toBe("가까운집");
    expect(places[1].name).toBe("먼집");
  });

  it("직선거리라고 밝힌 문구를 함께 준다", async () => {
    const result = await search("강남역 한정식");
    const places = (result.toolOutput as { places: Array<{ distanceLabel: string | null }> }).places;
    expect(places[0].distanceLabel).toMatch(/^강남역에서 직선 약 \d/u);
  });

});

describe("확신할 수 없으면 오늘과 같게 둔다", () => {
  it("기준점 조회가 실패하면 순서를 손대지 않는다", async () => {
    // 이 경우 결과는 리뷰 많은 순 그대로여야 한다. 흔들면 회귀다.
    calls.anchorFails = true;
    const result = await search("강남역 한정식");
    const places = (result.toolOutput as { places: Array<{ name: string; distanceLabel: string | null }> }).places;
    expect(places[0].name).toBe("먼집");
    expect(places[0].distanceLabel).toBeNull();
  });

  it("검색어에 기준점이 없으면 기준점을 찾지도 않는다", async () => {
    await search("한정식");
    const localQueries = calls.urls
      .filter((u) => u.includes("/search/v1/local"))
      .map((u) => new URL(u).searchParams.get("query"));
    expect(localQueries.every((q) => q === "한정식")).toBe(true);
  });
});
