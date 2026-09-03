import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSearchNearbyPlaces, generalizePlaceQuery } from "../placeSearchTools";

/**
 * "3곳 알려줘" 인데 카드가 2장만 나오던 문제. (2026-09-03 감사)
 *
 * 네이버가 5건을 줘도 예식장·웨딩홀 분류가 걸러지면 카드가 줄었고, 보충할 길이
 * 없었다. 이제 필터를 지난 곳이 3곳 미만이면 종류를 일반화한 질의로 **한 번만**
 * 더 찾는다. 지역 검색 호출은 어느 갈래에서도 최대 2회다.
 */

const ENV_KEYS = ["NAVER_API_HUB_CLIENT_ID", "NAVER_API_HUB_CLIENT_SECRET"] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function localItem(overrides: Record<string, unknown> = {}) {
  return {
    title: "<b>기본 식당</b>",
    link: "https://example.com/place",
    category: "음식점>한식",
    description: "가족 모임",
    telephone: "042-000-0000",
    address: "대전 서구 둔산동",
    roadAddress: "대전 서구 둔산로 1",
    mapx: "1273000000",
    mapy: "363000000",
    ...overrides,
  };
}

function weddingItem(index: number) {
  return localItem({
    title: `<b>대전컨벤션웨딩홀 ${index}</b>`,
    category: "예식장>웨딩홀",
    description: "예식 전문",
    address: `대전 서구 웨딩로 ${index}`,
    roadAddress: `대전 서구 웨딩로 ${index}`,
  });
}

function stubSearchFetch(handler: (url: URL) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(new URL(String(input))));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function localQueries(fetchMock: ReturnType<typeof stubSearchFetch>): (string | null)[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname.endsWith("/local"))
    .map((url) => url.searchParams.get("query"));
}

describe("장소 검색 보충", () => {
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

  it("걸러져 2곳만 남으면 종류를 일반화해 한 번 더 찾아 합친다", async () => {
    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        const query = url.searchParams.get("query");
        if (query === "대전 식당 예식") {
          return jsonResponse({
            items: [
              weddingItem(1),
              localItem({
                title: "<b>라마다 에이치가든</b>",
                address: "대전 서구 가든로 2",
                roadAddress: "대전 서구 가든로 2",
              }),
              weddingItem(2),
              localItem({
                title: "<b>크리스탈컨벤션뷔페</b>",
                category: "음식점>뷔페",
                address: "대전 유성구 뷔페로 3",
                roadAddress: "대전 유성구 뷔페로 3",
              }),
              weddingItem(3),
            ],
          });
        }
        if (query === "대전 식당") {
          return jsonResponse({
            items: [
              // 앞 검색과 같은 자리. 이름+주소가 같으므로 한 번만 남아야 한다.
              localItem({
                title: "<b>라마다 에이치가든</b>",
                address: "대전 서구 가든로 2",
                roadAddress: "대전 서구 가든로 2",
              }),
              localItem({
                title: "<b>둔산 한상</b>",
                address: "대전 서구 둔산로 9",
                roadAddress: "대전 서구 둔산로 9",
              }),
              localItem({
                title: "<b>유성 정식</b>",
                address: "대전 유성구 온천로 4",
                roadAddress: "대전 유성구 온천로 4",
              }),
            ],
          });
        }
        throw new Error(`Unexpected local query: ${query}`);
      }
      if (url.pathname.endsWith("/image")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "대전 식당 예식" });
    const output = result.toolOutput as {
      places: { name: string }[];
      resultCount: number;
      effectiveQuery: string;
    };

    expect(result.success).toBe(true);
    expect(localQueries(fetchMock)).toEqual(["대전 식당 예식", "대전 식당"]);
    expect(output.places.map((place) => place.name)).toEqual([
      "라마다 에이치가든",
      "크리스탈컨벤션뷔페",
      "둔산 한상",
      "유성 정식",
    ]);
    expect(output.resultCount).toBe(4);
    expect(output.effectiveQuery).toBe("대전 식당 예식, 대전 식당");
  });

  it("이미 3곳 이상이면 보충하지 않는다", async () => {
    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({
          items: [
            localItem({ title: "<b>가나식당</b>", address: "대전 서구 1", roadAddress: "대전 서구 1" }),
            localItem({ title: "<b>나다식당</b>", address: "대전 서구 2", roadAddress: "대전 서구 2" }),
            localItem({ title: "<b>다라식당</b>", address: "대전 서구 3", roadAddress: "대전 서구 3" }),
          ],
        });
      }
      if (url.pathname.endsWith("/image")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "대전 식당 예식" });
    const output = result.toolOutput as { places: unknown[]; effectiveQuery: string };

    expect(output.places).toHaveLength(3);
    expect(localQueries(fetchMock)).toEqual(["대전 식당 예식"]);
    expect(output.effectiveQuery).toBe("대전 식당 예식");
  });

  it("웨딩 업체 차단이면 보충은커녕 네이버를 부르지도 않는다", async () => {
    const fetchMock = stubSearchFetch(() => jsonResponse({ items: [] }));

    const result = await executeSearchNearbyPlaces({ query: "대전 웨딩홀" });

    expect(result.success).toBe(false);
    expect((result.toolOutput as { reason?: string }).reason).toBe("wedding_vendor_query_blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("줄인 재시도를 이미 썼으면 보충하지 않는다 — 지역 검색은 최대 2회다", async () => {
    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        const query = url.searchParams.get("query");
        // 말하듯 쓴 첫 질의는 0건, 서버가 줄인 질의에서 1건.
        if (query === "대전 조용한 룸 있는 식당") return jsonResponse({ items: [] });
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname.endsWith("/image")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "대전 조용한 룸 있는 식당" });
    const output = result.toolOutput as { places: unknown[] };
    const queries = localQueries(fetchMock);

    expect(result.success).toBe(true);
    expect(output.places).toHaveLength(1);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toBe("대전 조용한 룸 있는 식당");
    expect(queries[1]).not.toBe("대전 조용한 룸 있는 식당");
  });

  it("보충 검색이 실패해도 처음 찾은 곳은 그대로 보여준다", async () => {
    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        const query = url.searchParams.get("query");
        if (query === "대전 식당 예식") return jsonResponse({ items: [localItem()] });
        return jsonResponse({ error: "quota exceeded" }, 429);
      }
      if (url.pathname.endsWith("/image")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "대전 식당 예식" });
    const output = result.toolOutput as { places: { name: string }[]; effectiveQuery: string };

    expect(result.success).toBe(true);
    expect(output.places.map((place) => place.name)).toEqual(["기본 식당"]);
    expect(output.effectiveQuery).toBe("대전 식당 예식");
  });
});

describe("generalizePlaceQuery", () => {
  it.each([
    ["대전 식당 예식", "대전 식당"],
    ["제주 예식 대관", "제주 식당"],
    ["강남역 근처 상견례 한정식", "강남역 한정식"],
  ])("%s → %s", (query, expected) => {
    expect(generalizePlaceQuery(query)).toBe(expected);
  });

  it.each([
    // 더 일반화할 것이 없다.
    "대전 한정식",
    // 지역이 사라져 전국 검색이 된다.
    "예식 식당",
    // 남는 말이 없다.
    "예식 대관",
  ])("일반화할 것이 없으면 보충하지 않는다: %s", (query) => {
    expect(generalizePlaceQuery(query)).toBeNull();
  });

  // 이런 질의는 실행기 앞단에서 이미 차단되므로 보충 갈래까지 오지 않는다.
  // 함수 자체를 다른 곳에서 쓰게 될 때를 위한 마지막 방어다.
  it("일반화한 질의가 웨딩 업체 질의가 되면 하지 않는다", () => {
    expect(generalizePlaceQuery("서울 웨딩스튜디오 근처")).toBeNull();
  });
});
