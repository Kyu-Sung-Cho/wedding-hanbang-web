import { afterEach, describe, expect, it, vi } from "vitest";
import { executeSearchNearbyPlaces } from "../placeSearchTools";

const originalEnv = {
  NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID,
  NEXT_PUBLIC_NAVER_CLIENT_ID: process.env.NEXT_PUBLIC_NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET,
};

function restoreEnv(key: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("placeSearchTools", () => {
  afterEach(() => {
    restoreEnv("NAVER_CLIENT_ID", originalEnv.NAVER_CLIENT_ID);
    restoreEnv("NEXT_PUBLIC_NAVER_CLIENT_ID", originalEnv.NEXT_PUBLIC_NAVER_CLIENT_ID);
    restoreEnv("NAVER_CLIENT_SECRET", originalEnv.NAVER_CLIENT_SECRET);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the existing missing API key response", async () => {
    delete process.env.NAVER_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_NAVER_CLIENT_ID;
    delete process.env.NAVER_CLIENT_SECRET;

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });

    expect(result).toMatchObject({
      toolName: "search_nearby_places",
      toolOutput: {},
      success: false,
      displayMessage: "네이버 API 키가 설정되지 않았습니다.",
    });
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
    process.env.NAVER_CLIENT_ID = "client-id";
    process.env.NAVER_CLIENT_SECRET = "client-secret";
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeSearchNearbyPlaces({ query });

    expect(result).toMatchObject({
      toolName: "search_nearby_places",
      toolOutput: {
        query,
        reason: "wedding_vendor_query_blocked",
      },
      success: false,
      displayMessage: "웨딩 업체 검색은 검수된 공시가 탐색을 이용해주세요.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps only Naver Local results without fetching blog-derived price data", async () => {
    process.env.NAVER_CLIENT_ID = "client-id";
    process.env.NAVER_CLIENT_SECRET = "client-secret";

    const fetchMock = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                title: "<b>한방정식</b>",
                link: "https://example.com/place",
                category: "음식점>한식>한정식",
                description: "상견례 장소",
                telephone: "02-0000-0000",
                address: "서울 강남구 역삼동",
                roadAddress: "서울 강남구 테헤란로",
                mapx: "0",
                mapy: "0",
              },
            ],
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await executeSearchNearbyPlaces({ query: "강남 상견례" });
    const output = result.toolOutput as {
      places: Array<Record<string, unknown>>;
      query: string;
    };

    expect(result.toolName).toBe("search_nearby_places");
    expect(result.success).toBe(true);
    expect(result.displayMessage).toBe("'강남 상견례' 검색 결과 1곳을 찾았습니다.");
    expect(output.query).toBe("강남 상견례");
    expect(output.places[0]).toMatchObject({
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
      link: "https://example.com/place",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/search/local.json");
  });

  it("keeps only general places when Naver Local mixes in wedding vendors", async () => {
    process.env.NAVER_CLIENT_ID = "client-id";
    process.env.NAVER_CLIENT_SECRET = "client-secret";
    const fetchMock = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          {
            title: "<b>샘플 웨딩 스튜디오</b>",
            link: "https://example.com/wedding-vendor",
            category: "서비스>웨딩>웨딩 사진",
            description: "본식 촬영 업체",
            telephone: "",
            address: "서울 강남구",
            roadAddress: "서울 강남구",
            mapx: "0",
            mapy: "0",
          },
          {
            title: "<b>샘플 한정식</b>",
            link: "https://example.com/restaurant",
            category: "음식점>한식>한정식",
            description: "상견례 식사 장소",
            telephone: "",
            address: "서울 강남구",
            roadAddress: "서울 강남구",
            mapx: "0",
            mapy: "0",
          },
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeSearchNearbyPlaces({ query: "강남역 근처 상견례 식당" });
    const output = result.toolOutput as { places: Array<{ name: string }> };

    expect(result.success).toBe(true);
    expect(output.places).toEqual([expect.objectContaining({ name: "샘플 한정식" })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty general-place result when every local item is a wedding vendor", async () => {
    process.env.NAVER_CLIENT_ID = "client-id";
    process.env.NAVER_CLIENT_SECRET = "client-secret";
    const fetchMock = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          title: "샘플 본식 스냅",
          link: "https://example.com/wedding-vendor",
          category: "서비스>웨딩>사진",
          description: "웨딩 촬영 업체",
          telephone: "",
          address: "서울 강남구",
          roadAddress: "서울 강남구",
          mapx: "0",
          mapy: "0",
        }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const query = "강남역 근처 상견례 식당";
    const result = await executeSearchNearbyPlaces({ query });

    expect(result).toMatchObject({
      success: true,
      toolOutput: { places: [], query },
      displayMessage: `'${query}'에서 일반 장소 검색 결과를 찾지 못했습니다.`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
