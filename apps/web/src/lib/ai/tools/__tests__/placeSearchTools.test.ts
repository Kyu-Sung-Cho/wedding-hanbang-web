import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSearchNearbyPlaces } from "../placeSearchTools";

const ENV_KEYS = [
  "NAVER_API_HUB_CLIENT_ID",
  "NAVER_API_HUB_CLIENT_SECRET",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "NEXT_PUBLIC_NAVER_CLIENT_ID",
] as const;

type EnvKey = typeof ENV_KEYS[number];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<EnvKey, string | undefined>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function localItem(overrides: Record<string, unknown> = {}) {
  return {
    title: "<b>한방정식</b>",
    link: "https://example.com/place",
    category: "음식점>한식>한정식",
    description: "상견례 장소",
    telephone: "02-0000-0000",
    address: "서울 강남구 역삼동",
    roadAddress: "서울 강남구 테헤란로",
    mapx: "1270123456",
    mapy: "375012345",
    ...overrides,
  };
}

function stubSearchFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new URL(String(input)), init)
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("placeSearchTools", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
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

  it("does not accept a public client id when server credentials are missing", async () => {
    process.env.NEXT_PUBLIC_NAVER_CLIENT_ID = "must-not-be-used";

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });

    expect(result).toMatchObject({
      toolName: "search_nearby_places",
      toolOutput: {
        places: [],
        query: "강남 상견례",
        error: "naver_api_not_configured",
      },
      success: false,
      displayMessage: "네이버 API 키가 설정되지 않았습니다.",
    });
  });

  it("rejects an empty query before calling Naver", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    const fetchMock = stubSearchFetch(() => jsonResponse({ items: [] }));

    const result = await executeSearchNearbyPlaces({ query: "   " });

    expect(result).toMatchObject({
      success: false,
      toolOutput: { places: [], query: "", error: "invalid_query" },
      displayMessage: "검색할 지역과 장소를 알려주세요.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers API HUB and combines local and image results without processing blog content", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    process.env.NAVER_CLIENT_ID = "legacy-id";
    process.env.NAVER_CLIENT_SECRET = "legacy-secret";

    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname === "/search/v1/local") {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname === "/search/v1/image") {
        return jsonResponse({
          items: [{
            title: "<b>한방정식</b> 내부",
            link: "https://photos.example.com/hanbang",
            thumbnail: "https://search.pstatic.net/common/hanbang.jpg",
          }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      query: string;
      provider: string;
      partial: boolean;
      warnings: string[];
    };
    const place = output.places[0];

    expect(result.success).toBe(true);
    expect(result.displayMessage).toBe("'강남 상견례' 검색 결과 1곳을 찾았습니다.");
    expect(output).toMatchObject({
      query: "강남 상견례",
      provider: "api_hub",
      partial: false,
      warnings: [],
    });
    expect(place).toMatchObject({
      id: "naver-0",
      name: "한방정식",
      address: "서울 강남구 테헤란로",
      category: "한정식",
      categoryFull: "음식점>한식>한정식",
      cuisineType: "한식",
      description: "상견례 장소",
      telephone: "02-0000-0000",
      priceRange: null,
      hasPrivateRoom: false,
      blogReviewCount: 0,
      blogSnippet: null,
      imageUrl: "https://search.pstatic.net/common/hanbang.jpg",
      imageSourceUrl: null,
      imageTitle: "한방정식 내부",
      link: "https://example.com/place",
      mapx: "1270123456",
      mapy: "375012345",
    });
    expect(new URL(String(place.searchUrl)).searchParams.get("query"))
      .toBe("한방정식 서울 강남구 테헤란로");
    expect(String(place.mapsUrl)).toContain("https://map.naver.com/p/search/");
    expect(decodeURIComponent(String(place.mapsUrl)))
      .toContain("한방정식 서울 강남구 테헤란로");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(new URL(String(input)).origin).toBe("https://naverapihub.apigw.ntruss.com");
      expect(init?.headers).toEqual({
        "X-NCP-APIGW-API-KEY-ID": "hub-id",
        "X-NCP-APIGW-API-KEY": "hub-secret",
      });
    }
    const calledPaths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(calledPaths).toEqual(expect.arrayContaining([
      "/search/v1/local",
      "/search/v1/image",
    ]));
  });

  it("uses the legacy Developers API when API HUB credentials are absent", async () => {
    process.env.NAVER_CLIENT_ID = "legacy-id";
    process.env.NAVER_CLIENT_SECRET = "legacy-secret";

    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname === "/v1/search/local.json") {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname === "/v1/search/image.json") return jsonResponse({ items: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });
    const output = result.toolOutput as { provider: string; places: unknown[] };

    expect(result.success).toBe(true);
    expect(output.provider).toBe("legacy");
    expect(output.places).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(new URL(String(input)).origin).toBe("https://openapi.naver.com");
      expect(init?.headers).toEqual({
        "X-Naver-Client-Id": "legacy-id",
        "X-Naver-Client-Secret": "legacy-secret",
      });
    }
  });

  it("keeps place results when image enrichment fails", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";

    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) return jsonResponse({ items: [localItem()] });
      if (url.pathname.endsWith("/image")) return jsonResponse({ error: "temporarily unavailable" }, 503);
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      partial: boolean;
      warnings: string[];
    };

    expect(result.success).toBe(true);
    expect(result.displayMessage).toContain("검색 결과 1곳을 찾았습니다.");
    expect(result.displayMessage).toContain("일부 사진 정보는 불러오지 못했습니다.");
    expect(output.partial).toBe(true);
    expect(output.warnings).toContain("image_enrichment_failed");
    expect(output.places[0]).toMatchObject({ name: "한방정식", imageUrl: null });
  });

  it("accepts only HTTPS image thumbnails from a pstatic.net subdomain", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";

    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) return jsonResponse({ items: [localItem()] });
      if (url.pathname.endsWith("/image")) {
        return jsonResponse({
          items: [
            { thumbnail: "http://search.pstatic.net/insecure.jpg", link: "https://example.com/1" },
            { thumbnail: "https://pstatic.net.evil.example/fake.jpg", link: "https://example.com/2" },
            { thumbnail: "https://search.pstatic.net/safe.jpg", link: "javascript:alert(1)", title: "안전 이미지" },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });
    const output = result.toolOutput as { places: Array<Record<string, unknown>>; warnings: string[] };

    expect(result.success).toBe(true);
    expect(output.warnings).toEqual([]);
    expect(output.places[0]).toMatchObject({
      imageUrl: "https://search.pstatic.net/safe.jpg",
      imageSourceUrl: null,
      imageTitle: "안전 이미지",
    });
  });

  it("marks rejected image hosts without failing the local result", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";

    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) return jsonResponse({ items: [localItem()] });
      if (url.pathname.endsWith("/image")) {
        return jsonResponse({ items: [{ thumbnail: "https://images.example.com/not-allowed.jpg" }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      partial: boolean;
      warnings: string[];
    };

    expect(result.success).toBe(true);
    expect(output.partial).toBe(true);
    expect(output.warnings).toContain("image_url_rejected");
    expect(output.places[0].imageUrl).toBeNull();
  });

  it("returns a successful empty result without running enrichment calls", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    const fetchMock = stubSearchFetch(() => jsonResponse({ items: [] }));

    const result = await executeSearchNearbyPlaces({ query: "없는 장소" });

    expect(result).toMatchObject({
      success: true,
      toolOutput: { places: [], query: "없는 장소", provider: "api_hub" },
      displayMessage: "'없는 장소' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a clear failure when local search fails", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = stubSearchFetch(() => jsonResponse({ error: "quota exceeded" }, 429));

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });

    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        places: [],
        query: "강남 상견례",
        error: "naver_local_search_failed",
        provider: "api_hub",
        status: 429,
      },
      displayMessage: "네이버 장소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
