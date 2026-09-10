import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSearchNearbyPlaces } from "../placeSearchTools";

function item(name: string, category: string, region = "대전") {
  return { title: name, category, roadAddress: `${region} 중구 시험로 ${name}`,
    address: `${region} 중구 시험로 ${name}`, description: "", telephone: "",
    link: "https://example.com/place", mapx: "", mapy: "" };
}
const BAKERY = item("시험 빵집", "카페,디저트>베이커리");
const CAFE = item("시험 카페", "카페,디저트>카페");
const MEAL = item("시험 식당", "음식점>한식>주꾸미요리");

function stubSearch(results: (query: string) => ReturnType<typeof item>[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const items = url.pathname.endsWith("/local") ? results(url.searchParams.get("query") ?? "") : [];
    return new Response(JSON.stringify({ items }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function localQueries(fetchMock: ReturnType<typeof stubSearch>) {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)))
    .filter(url => url.pathname.endsWith("/local")).map(url => url.searchParams.get("query"));
}
function names(places: unknown): string[] {
  if (!Array.isArray(places)) throw new Error("Expected place array");
  return places.map(place => {
    if (!place || typeof place !== "object" || typeof place.name !== "string") throw new Error("Expected named place");
    return place.name;
  });
}

describe("meal place search excludes known dessert-only categories", () => {
  beforeEach(() => {
    vi.stubEnv("NAVER_API_HUB_CLIENT_ID", "fixture-id");
    vi.stubEnv("NAVER_API_HUB_CLIENT_SECRET", "fixture-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    { remaining: [], count: 0 },
    { remaining: [MEAL], count: 1 },
    { remaining: [MEAL, item("둘째 식당", "음식점>중식"), item("셋째 식당", "음식점>뷔페")], count: 3 },
  ])("reports actual $count meal candidates without filling the requested three with bakeries", async ({ remaining, count }) => {
    const fetchMock = stubSearch(() => [BAKERY, CAFE, ...remaining]);
    const result = await executeSearchNearbyPlaces({ query: "대전 식당", requestedCount: 3 });
    expect(result.success).toBe(true);
    expect(names(result.toolOutput.places)).toEqual(remaining.map(place => place.title));
    expect(result.toolOutput).toMatchObject({ resultCount: count, requestedCount: 3, effectiveQuery: "대전 식당" });
    expect(localQueries(fetchMock)).toEqual(["대전 식당"]);
    if (count > 0) expect(result.displayMessage).toContain(`${count}곳`);
    else expect(result.displayMessage).toMatch(/없|찾지 못/);
    expect(result.displayMessage).not.toMatch(/수용 가능|예약 가능|보장/);
  });

  it.each(["대전 카페", "대전 베이커리", "대전 빵집", "대전 디저트", "대전 식당 카페", "대전 카페와 식당", "대전 식사 가능한 카페"])(
    "preserves an explicit cafe or dessert request: %s", async query => {
      stubSearch(() => [BAKERY, CAFE]);
      const result = await executeSearchNearbyPlaces({ query, requestedCount: 3 });
      expect(new Set(names(result.toolOutput.places))).toEqual(new Set(["시험 빵집", "시험 카페"]));
      expect(result.toolOutput.resultCount).toBe(2);
    },
  );

  it.each(["대전 카페 말고 식당", "대전 카페·베이커리 제외 식당"])(
    "does not treat a negated dessert category as an explicit request: %s", async query => {
      stubSearch(() => [BAKERY, CAFE, MEAL]);
      const result = await executeSearchNearbyPlaces({ query, requestedCount: 3 });
      expect(names(result.toolOutput.places)).toEqual(["시험 식당"]);
      expect(result.toolOutput.resultCount).toBe(1);
    },
  );

  it("preserves cafes when the user explicitly says not to exclude them", async () => {
    const query = "대전 카페 제외하지 말고 식당도 같이 찾아줘";
    const fetchMock = stubSearch(() => [BAKERY, CAFE, MEAL]);
    const result = await executeSearchNearbyPlaces({ query, requestedCount: 3 });
    expect(new Set(names(result.toolOutput.places))).toEqual(new Set(["시험 빵집", "시험 카페", "시험 식당"]));
    expect(result.toolOutput.resultCount).toBe(3);
    expect(localQueries(fetchMock)).toEqual([query]);
  });

  it("does not interpret the district 식사동 or an unspecified venue query as a meal requirement", async () => {
    stubSearch(() => [BAKERY, CAFE, item("시험 공간", "문화,예술>전통문화체험")]);
    const result = await executeSearchNearbyPlaces({ query: "식사동 모임 장소", requestedCount: 3 });
    expect(names(result.toolOutput.places)).toHaveLength(3);
  });

  it("does not discard unknown categories or invent food capacity evidence", async () => {
    stubSearch(() => [BAKERY, item("분류 미제공", ""), item("한옥 공간", "문화,예술>전통문화체험")]);
    const result = await executeSearchNearbyPlaces({ query: "대전 식사 모임", requestedCount: 3 });
    expect(names(result.toolOutput.places)).toEqual(["분류 미제공", "한옥 공간"]);
    expect(result.toolOutput.resultCount).toBe(2);
    expect(result.toolOutput).not.toHaveProperty("capacity");
  });

  it("uses the same filter for primary and existing supplement results without adding a new query", async () => {
    const queries = ["대전 식당 예식", "대전 식당"];
    const fetchMock = stubSearch(query => query === queries[0]
      ? [item("차단 웨딩홀", "예식장>웨딩홀"), MEAL]
      : [BAKERY, CAFE, item("보충 식당", "음식점>뷔페")]);
    const result = await executeSearchNearbyPlaces({ query: queries[0], requestedCount: 3 });
    expect(names(result.toolOutput.places)).toEqual(["시험 식당", "보충 식당"]);
    expect(result.toolOutput.resultCount).toBe(2);
    expect(localQueries(fetchMock)).toEqual(queries);
  });

  it("filters each of two regions while keeping both regions and the two-query ceiling", async () => {
    const fetchMock = stubSearch(query => {
      const region = query.startsWith("청주") ? "청주" : "대전";
      return [item(`${region} 빵집`, "음식점>카페,디저트>베이커리", region),
        item(`${region} 식당`, "음식점>한식", region)];
    });
    const result = await executeSearchNearbyPlaces({ query: "대전이나 청주 식당", requestedCount: 3 });
    expect(names(result.toolOutput.places)).toEqual(["대전 식당", "청주 식당"]);
    expect(result.toolOutput.resultCount).toBe(2);
    expect(localQueries(fetchMock)).toEqual(["대전 식당", "청주 식당"]);
  });

  it("does not restore dessert results after an existing shortened-query retry", async () => {
    const fetchMock = stubSearch(query => query === "대전 근처 조용한 식당" ? [] : [BAKERY, CAFE, MEAL]);
    const result = await executeSearchNearbyPlaces({ query: "대전 근처 조용한 식당", requestedCount: 3 });
    expect(names(result.toolOutput.places)).toEqual(["시험 식당"]);
    expect(result.toolOutput.resultCount).toBe(1);
    expect(localQueries(fetchMock)).toEqual(["대전 근처 조용한 식당", "대전 식당"]);
  });
});
