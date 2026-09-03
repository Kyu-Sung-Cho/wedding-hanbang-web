import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSearchNearbyPlaces, splitPlaceQueryByRegion } from "../placeSearchTools";

// 2026-09-03 — "대전이나 청주 한정식" 을 물으면 앞 지역만 검색되고 청주 후보는 한 장도
// 안 나왔다. 도구 스키마가 지역 하나를 전제했고, 장소 검색이 한 번 돌면 그 턴의 도구가
// 잠기므로 모델이 이어서 두 번째 지역을 찾을 방법이 없었다. 서버가 나눠 부른다.
//
// 이 파일은 **같은 입력에 같은 결과**로 묻는다 — 소스에 문자열이 있는지가 아니라,
// 실행기가 어떤 질의를 몇 번 보내고 무엇을 돌려주는지로.

const ENV_KEYS = [
  "NAVER_API_HUB_CLIENT_ID",
  "NAVER_API_HUB_CLIENT_SECRET",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<typeof ENV_KEYS[number], string | undefined>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function localItem(name: string, address: string) {
  return {
    title: `<b>${name}</b>`,
    link: "https://example.com/place",
    category: "음식점>한식>한정식",
    description: "한정식",
    telephone: "042-000-0000",
    address,
    roadAddress: address,
    mapx: "1270123456",
    mapy: "375012345",
  };
}

/** 지역 검색만 골라 센다. 사진 검색(`/search/v1/image`)은 후보 수만큼 따로 나간다. */
function localSearchQueries(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname.endsWith("/local"))
    .map((url) => url.searchParams.get("query") ?? "");
}

function stubSearchFetch(handler: (url: URL) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(new URL(String(input))));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("두 지역 장소 검색", () => {
  beforeEach(() => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("지역이 둘이면 지역별로 한 번씩 찾고 두 지역 후보를 함께 돌려준다", async () => {
    const fetchMock = stubSearchFetch((url) => {
      if (!url.pathname.endsWith("/local")) return jsonResponse({ items: [] });
      const query = url.searchParams.get("query") ?? "";
      if (query.startsWith("대전")) {
        return jsonResponse({
          items: [
            localItem("대전한상", "대전 서구 둔산로 1"),
            localItem("대전정식", "대전 유성구 대학로 2"),
            localItem("대전한정식", "대전 중구 중앙로 3"),
            localItem("대전미담", "대전 서구 계룡로 4"),
            localItem("대전소반", "대전 동구 동서대로 5"),
          ],
        });
      }
      if (query.startsWith("청주")) {
        return jsonResponse({
          items: [
            localItem("청주한상", "청주 흥덕구 대농로 1"),
            localItem("청주정식", "청주 상당구 상당로 2"),
          ],
        });
      }
      return jsonResponse({ items: [] });
    });

    const result = await executeSearchNearbyPlaces({ query: "대전이나 청주 한정식" });
    const output = result.toolOutput as {
      places: { id: string; name: string; regionLabel: string | null }[];
      resultCount: number;
      effectiveQuery: string;
      searchedAt: string;
    };

    expect(result.success).toBe(true);
    // 네이버 지역 검색은 지역당 한 번, 모두 두 번. 한 지역 갈래(첫 시도 + 재시도)와 같은 상한이다.
    expect(localSearchQueries(fetchMock)).toEqual(["대전 한정식", "청주 한정식"]);

    const regions = output.places.map((place) => place.regionLabel);
    expect(regions).toContain("대전");
    expect(regions).toContain("청주");
    // 번갈아 담으므로 한 지역이 다섯 자리를 다 먹지 않는다.
    expect(regions.filter((region) => region === "청주").length).toBe(2);
    expect(output.places.length).toBe(5);
    expect(output.resultCount).toBe(5);
    expect(output.effectiveQuery).toBe("대전 한정식, 청주 한정식");
    expect(Number.isNaN(new Date(output.searchedAt).getTime())).toBe(false);
    // 카드 key 가 겹치면 한 장이 사라진다.
    expect(new Set(output.places.map((place) => place.id)).size).toBe(5);
  });

  it("두 지역에 같은 가게가 나오면 한 번만 남긴다", async () => {
    stubSearchFetch((url) => {
      if (!url.pathname.endsWith("/local")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [localItem("같은집", "대전 서구 둔산로 1")] });
    });

    const result = await executeSearchNearbyPlaces({ query: "대전 또는 청주 한정식" });
    const output = result.toolOutput as { places: { name: string }[]; resultCount: number };

    expect(output.places.map((place) => place.name)).toEqual(["같은집"]);
    expect(output.resultCount).toBe(1);
  });

  it("두 지역 검색이 모두 비면 결과 없음으로 끝내고 조회 시각을 남긴다", async () => {
    const fetchMock = stubSearchFetch(() => jsonResponse({ items: [] }));

    const result = await executeSearchNearbyPlaces({ query: "대전이나 청주 한정식" });
    const output = result.toolOutput as {
      places: unknown[];
      resultCount: number;
      effectiveQuery: string;
      searchedAt: string;
    };

    expect(result.success).toBe(true);
    expect(output.places).toEqual([]);
    expect(output.resultCount).toBe(0);
    expect(output.effectiveQuery).toBe("대전 한정식, 청주 한정식");
    expect(Number.isNaN(new Date(output.searchedAt).getTime())).toBe(false);
    expect(localSearchQueries(fetchMock).length).toBe(2);
  });

  it("한 지역 검색어는 예전 그대로 한 번만 찾고 지역 딱지를 붙이지 않는다", async () => {
    const fetchMock = stubSearchFetch((url) => {
      if (!url.pathname.endsWith("/local")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [localItem("강남한상", "서울 강남구 테헤란로 1")] });
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 한정식" });
    const output = result.toolOutput as {
      places: { regionLabel: string | null }[];
      resultCount: number;
      effectiveQuery: string;
    };

    expect(localSearchQueries(fetchMock)).toEqual(["강남 한정식"]);
    expect(output.places[0].regionLabel).toBeNull();
    expect(output.resultCount).toBe(1);
    expect(output.effectiveQuery).toBe("강남 한정식");
  });

  // "그리고" 이음말과 지역이 아닌 말은 가르지 않는다. 가르면 엉뚱한 검색어 두 개가 나간다.
  it.each([
    "부모님과 상견례 한정식",
    "부모님 나들이 카페",
    "강남 한정식",
    "상견례나 회식 한정식",
  ])("지역이 아닌 말은 가르지 않는다: %s", (query) => {
    expect(splitPlaceQueryByRegion(query)).toBeNull();
  });

  it.each([
    ["대전이나 청주 한정식", ["대전", "청주"], "한정식"],
    ["대전 또는 청주 한정식", ["대전", "청주"], "한정식"],
    ["대전, 청주 한정식", ["대전", "청주"], "한정식"],
    ["강남이나 서초 한식당", ["강남", "서초"], "한식당"],
  ])("두 지역을 가른다: %s", (query, regions, rest) => {
    expect(splitPlaceQueryByRegion(query as string)).toEqual({ regions, rest });
  });
});
