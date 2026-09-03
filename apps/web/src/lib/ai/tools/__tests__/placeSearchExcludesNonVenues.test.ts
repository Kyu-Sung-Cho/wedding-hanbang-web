import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSearchNearbyPlaces } from "../placeSearchTools";

// 2026-09-03 스테이징 실측 — "대전이나 청주 식당 예식" 에 `청주성모병원장례식장`(장례>장례식장)이,
// "대전이나 청주 연회장" 에 아파트 관리사무소 방면 표지(도로시설>방면정보)가 카드로 나왔다.
// 결혼 준비 장소 검색에서 그 업종은 어떤 검색어에서도 후보가 아니다.
//
// 이 파일은 **같은 입력에 같은 결과**로 묻는다 — 네이버 응답을 그대로 흉내 내고,
// 실행기가 무엇을 카드로 돌려주는지로. 정상 업종(음식점·카페)이 함께 사라지지 않는 것도 같은 방식으로 본다.

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

function localItem(name: string, address: string, category: string) {
  return {
    title: `<b>${name}</b>`,
    link: "https://example.com/place",
    category,
    description: "",
    telephone: "042-000-0000",
    address,
    roadAddress: address,
    mapx: "1270123456",
    mapy: "375012345",
  };
}

function stubSearchFetch(handler: (url: URL) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(new URL(String(input))));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("장소 검색은 장례식장·도로 표지를 후보로 내지 않는다", () => {
  beforeEach(() => {
    process.env.NAVER_API_HUB_CLIENT_ID = "hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "hub-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("장례·도로시설 업종은 빠지고 음식점·카페는 그대로 남는다", async () => {
    stubSearchFetch((url) => {
      if (!url.pathname.endsWith("/local")) return jsonResponse({ items: [] });
      return jsonResponse({
        items: [
          localItem("라마다대전 에이치가든", "대전 유성구 계룡로 127", "음식점>뷔페"),
          localItem("청주성모병원장례식장", "청주 청원구 주성로 173", "장례>장례식장"),
          localItem("크리스탈컨벤션뷔페", "대전 서구 둔산대로117번길 127", "음식점>뷔페"),
          localItem("린풀하우스아파트 관리사무소 (1층, 연회장)", "대전 서구 도안동로 1", "도로시설>방면정보"),
          localItem("성심당 본점", "대전 중구 대종로480번길 15", "카페,디저트>베이커리"),
        ],
      });
    });

    const result = await executeSearchNearbyPlaces({ query: "대전 식당 예식" });
    const output = result.toolOutput as { places: { name: string; categoryFull: string }[]; resultCount: number };

    expect(result.success).toBe(true);
    const names = output.places.map((place) => place.name);
    expect(names).toEqual(["라마다대전 에이치가든", "크리스탈컨벤션뷔페", "성심당 본점"]);
    expect(output.places.every((place) => !/^(?:장례|도로시설)/.test(place.categoryFull))).toBe(true);
    expect(output.resultCount).toBe(3);
  });

  it("업종이 비어 있거나 낯선 업종이면 거르지 않는다 — 필터는 두 업종만 안다", async () => {
    stubSearchFetch((url) => {
      if (!url.pathname.endsWith("/local")) return jsonResponse({ items: [] });
      return jsonResponse({
        items: [
          localItem("이름만 있는 곳", "대전 서구 둔산로 1", ""),
          localItem("한옥 대관", "대전 동구 동서대로 5", "문화,예술>전통문화체험"),
        ],
      });
    });

    const result = await executeSearchNearbyPlaces({ query: "대전 한정식" });
    const output = result.toolOutput as { places: { name: string }[] };

    expect(result.success).toBe(true);
    expect(output.places.map((place) => place.name)).toEqual(["이름만 있는 곳", "한옥 대관"]);
  });
});
