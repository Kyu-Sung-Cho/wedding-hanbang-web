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
    address: "서울 강남구 삼성동",
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

function expectHandoff(output: Record<string, unknown>, query: string) {
  expect(output.providerUnavailable).toBe(true);
  expect(output.handoff).toEqual({
    searchUrl: `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`,
    mapsUrl: `https://map.naver.com/p/search/${encodeURIComponent(query)}`,
  });
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

  it("rejects an empty query before calling NAVER", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    const fetchMock = stubSearchFetch(() => jsonResponse({ items: [] }));

    const result = await executeSearchNearbyPlaces({ query: "   " });

    expect(result).toMatchObject({
      success: false,
      toolOutput: { places: [], query: "", error: "invalid_query" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "강남 웨딩 스튜디오",
    "서울 결혼식장",
    "결혼 준비 업체 찾아줘",
    "혼주 메이크업 업체",
    "웨딩 촬영 사진관",
    "웨딩 사진 업체",
    "본식 스냅",
    "예식 업체 추천",
  ])("rejects wedding vendor search before any external request: %s", async (query) => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    const fetchMock = stubSearchFetch(() => jsonResponse({ items: [] }));

    const result = await executeSearchNearbyPlaces({ query });

    expect(result).toMatchObject({
      toolName: "search_nearby_places",
      toolOutput: {
        places: [],
        query,
        reason: "wedding_vendor_query_blocked",
      },
      success: false,
      displayMessage: "웨딩 업체 검색은 검수된 공시가 탐색을 이용해주세요.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses API HUB only and enriches a place with an identity-matched image", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "  hub-id  ";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "  hub-secret  ";
    process.env.NAVER_CLIENT_ID = "legacy-id";
    process.env.NAVER_CLIENT_SECRET = "legacy-secret";

    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname === "/search/v1/local") {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname === "/search/v1/image") {
        return jsonResponse({
          items: [{
            title: "<b>한방정식</b> 강남점 외관",
            thumbnail: "https://search.pstatic.net/common/hanbang.jpg",
          }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례 식당" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      provider: string;
      providerUnavailable: boolean;
      partial: boolean;
      warnings: string[];
    };

    expect(result.success).toBe(true);
    expect(output).toMatchObject({
      provider: "api_hub",
      providerUnavailable: false,
      partial: false,
      warnings: [],
    });
    expect(output.places).toHaveLength(1);
    expect(output.places[0]).toMatchObject({
      id: "naver-0",
      name: "한방정식",
      address: "서울 강남구 테헤란로",
      category: "한정식",
      categoryFull: "음식점>한식>한정식",
      cuisineType: "한식",
      description: "상견례 장소",
      telephone: "02-0000-0000",
      imageUrl: "https://search.pstatic.net/common/hanbang.jpg",
      imageSourceUrl: null,
      imageTitle: "한방정식 강남점 외관",
      link: "https://example.com/place",
    });
    // 링크는 **이름 + 구**로 간다. 전에는 주소를 통째로 붙였는데, 그러면
    // 검색어가 길어 네이버에서 결과가 아예 없는 가게가 있었다(2026-08-23 실측:
    // "부엉이산장 강남점 서울특별시 강남구 테헤란로1길 28-11 1층" → 0건,
    // "부엉이산장 강남점 강남구" → 1건). 눌러도 빈 화면이 뜨는 카드였다.
    expect(new URL(String(output.places[0].searchUrl)).searchParams.get("query"))
      .toBe("한방정식 강남구");
    expect(decodeURIComponent(String(output.places[0].mapsUrl)))
      .toContain("한방정식 강남구");

    // 지역 1 + 이미지 1 + 블로그 1. 블로그는 상품이 꺼져 있으면 실패하지만
    // 그 실패가 카드를 막지 않는다(아래 별도 테스트).
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(new URL(String(input)).origin).toBe("https://naverapihub.apigw.ntruss.com");
      expect(init?.headers).toEqual({
        "X-NCP-APIGW-API-KEY-ID": "hub-id",
        "X-NCP-APIGW-API-KEY": "hub-secret",
      });
    }
  });

  /**
   * 2026-08-23 운영의 실제 조건이다. API HUB 애플리케이션에 블로그 상품을
   * 신청하지 않으면 네이버가 401 을 준다:
   *
   *     {"error":{"errorCode":401,"message":"요청한 API는 이 Application에서
   *      활성화되어 있지 않습니다"}}
   *
   * 신청하지 않은 상품은 고장이 아니다. 그 실패로 장소 카드까지 못 내면
   * 사용자는 이유 없이 아무것도 못 받는다.
   */
  it("블로그 상품이 꺼져 있어도 장소 카드는 그대로 나온다", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname.endsWith("/image")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/blog")) {
        return jsonResponse({
          error: {
            errorCode: 401,
            message: "요청한 API는 이 Application에서 활성화되어 있지 않습니다.",
          },
        }, 401);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 한정식" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      warnings?: string[];
    };

    expect(result.success).toBe(true);
    expect(output.places).toHaveLength(1);
    expect(output.places[0].name).toBe("한방정식");
    // 리뷰 자리는 비어 있을 뿐, 카드는 이름·주소로 그대로 선다.
    expect(output.places[0].blogReviewCount).toBe(0);
    expect(output.places[0].blogSnippet).toBeNull();
    expect(output.places[0].priceRange).toBeNull();
    // 신청하지 않은 상품은 경고로 남기지 않는다 — 고장이 아니다.
    expect(output.warnings ?? []).not.toContain("blog_enrichment_failed");
  });

  it("keeps only general places when NAVER Local mixes in wedding vendors", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({
          items: [
            localItem({
              title: "<b>샘플 웨딩 스튜디오</b>",
              link: "https://example.com/wedding-vendor",
              category: "서비스>웨딩>웨딩 사진",
              description: "본식 촬영 업체",
            }),
            localItem({
              title: "<b>샘플 한정식</b>",
              link: "https://example.com/restaurant",
              description: "상견례 식사 장소",
            }),
          ],
        });
      }
      if (url.pathname.endsWith("/image")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남역 근처 상견례 식당" });
    const output = result.toolOutput as { places: Array<{ name: string }> };

    expect(result.success).toBe(true);
    expect(output.places).toEqual([expect.objectContaining({ name: "샘플 한정식" })]);
    // 지역 1 + 이미지 1 + 블로그 1.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns an empty general-place result when every local item is a wedding vendor", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    const fetchMock = stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({
          items: [localItem({
            title: "샘플 본식 스냅",
            link: "https://example.com/wedding-vendor",
            category: "서비스>웨딩>사진",
            description: "웨딩 촬영 업체",
          })],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const query = "강남역 근처 상견례 식당";
    const result = await executeSearchNearbyPlaces({ query });

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        places: [],
        query,
        provider: "api_hub",
        providerUnavailable: false,
      },
      displayMessage: `'${query}'에서 일반 장소 검색 결과를 찾지 못했습니다.`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to the legacy Developers API", async () => {
    process.env.NAVER_CLIENT_ID = "legacy-id";
    process.env.NAVER_CLIENT_SECRET = "legacy-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const query = "강남 상견례 식당";
    const result = await executeSearchNearbyPlaces({ query });
    const output = result.toolOutput as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(output).toMatchObject({
      places: [],
      query,
      error: "naver_api_not_configured",
    });
    expectHandoff(output, query);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips an unrelated first image and accepts a later identity match", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";

    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname.endsWith("/image")) {
        return jsonResponse({
          items: [
            {
              title: "전혀 다른 레스토랑",
              thumbnail: "https://search.pstatic.net/common/unrelated.jpg",
            },
            {
              title: "한방 정식 예약 후기",
              thumbnail: "https://search.pstatic.net/common/matched.jpg",
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례 식당" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      warnings: string[];
    };

    expect(result.success).toBe(true);
    expect(output.warnings).toEqual([]);
    expect(output.places[0]).toMatchObject({
      imageUrl: "https://search.pstatic.net/common/matched.jpg",
      imageTitle: "한방 정식 예약 후기",
    });
  });

  it("omits images whose titles cannot verify the place identity", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";

    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname.endsWith("/image")) {
        return jsonResponse({
          items: [{
            title: "다른 한정식 식당",
            thumbnail: "https://search.pstatic.net/common/wrong.jpg",
          }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례 식당" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      partial: boolean;
      warnings: string[];
    };

    expect(result.success).toBe(true);
    expect(output.partial).toBe(true);
    expect(output.warnings).toContain("image_identity_unverified");
    expect(output.places[0]).toMatchObject({
      imageUrl: null,
      imageTitle: null,
    });
  });

  it("rejects an identity match when the thumbnail is not HTTPS pstatic", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";

    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname.endsWith("/image")) {
        return jsonResponse({
          items: [{
            title: "한방정식 내부",
            thumbnail: "https://pstatic.net.evil.example/fake.jpg",
          }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례 식당" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      warnings: string[];
    };

    expect(result.success).toBe(true);
    expect(output.warnings).toContain("image_identity_unverified");
    expect(output.places[0].imageUrl).toBeNull();
  });

  it("keeps local places when API HUB image enrichment fails", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";

    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({ items: [localItem()] });
      }
      if (url.pathname.endsWith("/image")) {
        return jsonResponse({ error: "temporarily unavailable" }, 503);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례 식당" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      partial: boolean;
      warnings: string[];
    };

    expect(result.success).toBe(true);
    expect(output.partial).toBe(true);
    expect(output.warnings).toContain("image_enrichment_failed");
    expect(output.places[0]).toMatchObject({ name: "한방정식", imageUrl: null });
  });

  it("does not accept a public client id and returns an explicit direct handoff", async () => {
    process.env.NEXT_PUBLIC_NAVER_CLIENT_ID = "must-not-be-used";
    const query = "부산 한정식";

    const result = await executeSearchNearbyPlaces({ query });
    const output = result.toolOutput as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(output.error).toBe("naver_api_not_configured");
    expectHandoff(output, query);
  });

  it("returns a successful empty API HUB result without enrichment calls", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    const fetchMock = stubSearchFetch(() => jsonResponse({ items: [] }));

    const result = await executeSearchNearbyPlaces({ query: "없는 장소" });

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        places: [],
        query: "없는 장소",
        provider: "api_hub",
        providerUnavailable: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps failed provider calls distinct from a query-based NAVER handoff", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = stubSearchFetch(() => jsonResponse({ error: "quota exceeded" }, 429));
    const query = "강남 상견례 식당";

    const result = await executeSearchNearbyPlaces({ query });
    const output = result.toolOutput as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(output).toMatchObject({
      places: [],
      query,
      error: "naver_local_search_failed",
      provider: "api_hub",
      providerUnavailable: true,
      status: 429,
    });
    expectHandoff(output, query);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe provider links while preserving direct NAVER links", async () => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
    stubSearchFetch((url) => {
      if (url.pathname.endsWith("/local")) {
        return jsonResponse({ items: [localItem({ link: "javascript:alert(1)" })] });
      }
      if (url.pathname.endsWith("/image")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례 식당" });
    const output = result.toolOutput as { places: Array<Record<string, unknown>> };

    expect(result.success).toBe(true);
    expect(output.places[0].link).toBeNull();
    expect(String(output.places[0].searchUrl)).toMatch(/^https:\/\/search\.naver\.com\//);
    expect(String(output.places[0].mapsUrl)).toMatch(/^https:\/\/map\.naver\.com\//);
  });
});
