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

  it("maps Naver local and blog results into place cards", async () => {
    process.env.NAVER_CLIENT_ID = "client-id";
    process.env.NAVER_CLIENT_SECRET = "client-secret";

    const fetchMock = vi
      .fn<() => Promise<Response>>()
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 12,
            items: [
              {
                description: "프라이빗 룸이 있고 인당 50,000원 정도입니다.",
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
      priceRange: "인당 약 5만원",
      hasPrivateRoom: true,
      blogReviewCount: 12,
      blogSnippet: "프라이빗 룸이 있고 인당 50,000원 정도입니다.",
      link: "https://example.com/place",
    });
  });
});
