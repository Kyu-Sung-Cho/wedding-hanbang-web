import { afterEach, describe, expect, it } from "vitest";
import {
  executeSearchNearbyPlaces,
  isPlaceSearchConfigured,
} from "@/lib/ai/tools/placeSearchTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 상견례 식당처럼 **일반 장소**를 찾아주는 도구다. 웨딩 업체 검색이 아니다 —
 * 도구 안에 울타리가 두 겹 있다(질의 차단 + 네이버 결과에서 웨딩업체 필터링).
 *
 * 2026-08-22 이전에는 `BETA_DISABLED_TOOL_NAMES` 에 묶여 모델에게 아예 가지 않았다.
 * 웹 `VendorToolCard`·모바일 `PlaceCards` 카드 UI 는 이미 만들어져 있었는데도.
 *
 * 여는 김에 하나 더 막는다. 자격증명이 없을 때 이 도구는
 * `"네이버 API 키가 설정되지 않았습니다."` 를 **사용자에게** 돌려주고 있었다.
 * 내부 사정을 사용자에게 말하는 것이고, 이 저장소가 오늘만 세 번 고친 부류다
 * ("지금은 예산 변경을 실제 저장하는 도구가 없어…"). 쓸 수 없으면 **도구를 주지
 * 않는다** — 없는 기능을 설명하는 것보다 없는 편이 낫다.
 */

const ORIGINAL_ID = process.env.NAVER_API_HUB_CLIENT_ID;
const ORIGINAL_SECRET = process.env.NAVER_API_HUB_CLIENT_SECRET;

function setCredentials(id: string | undefined, secret: string | undefined) {
  if (id === undefined) delete process.env.NAVER_API_HUB_CLIENT_ID;
  else process.env.NAVER_API_HUB_CLIENT_ID = id;
  if (secret === undefined) delete process.env.NAVER_API_HUB_CLIENT_SECRET;
  else process.env.NAVER_API_HUB_CLIENT_SECRET = secret;
}

afterEach(() => {
  setCredentials(ORIGINAL_ID, ORIGINAL_SECRET);
});

describe("장소 검색은 쓸 수 있을 때만 제공한다", () => {
  it("자격증명이 없으면 사용 가능하다고 하지 않는다", () => {
    setCredentials(undefined, undefined);
    expect(isPlaceSearchConfigured()).toBe(false);
  });

  it("한쪽만 있으면 사용 불가다", () => {
    setCredentials("id-only", undefined);
    expect(isPlaceSearchConfigured()).toBe(false);
    setCredentials(undefined, "secret-only");
    expect(isPlaceSearchConfigured()).toBe(false);
  });

  it("빈 문자열은 설정된 것이 아니다", () => {
    setCredentials("   ", "   ");
    expect(isPlaceSearchConfigured()).toBe(false);
  });

  it("둘 다 있으면 사용 가능하다", () => {
    setCredentials("hub-id", "hub-secret");
    expect(isPlaceSearchConfigured()).toBe(true);
  });
});

describe("내부 사정을 사용자에게 말하지 않는다", () => {
  it("자격증명이 없을 때의 문구에 API·키·설정이 없다", async () => {
    setCredentials(undefined, undefined);
    const result = await executeSearchNearbyPlaces({ query: "강남역 근처 한식 식당" });

    expect(result.success).toBe(false);
    expect(result.displayMessage).not.toMatch(/API|키|설정|naver/iu);
    // 사용자가 다음에 뭘 할지는 알 수 있어야 한다.
    expect(result.displayMessage.trim().length).toBeGreaterThan(0);
  });
});

describe("웨딩 업체 검색은 계속 막혀 있다", () => {
  it.each([
    "강남 웨딩홀 추천해줘",
    "청담동 웨딩 스튜디오 알려줘",
    "드레스 업체 찾아줘",
    "본식 스냅 업체",
  ])("%s", async (query) => {
    setCredentials("hub-id", "hub-secret");
    const result = await executeSearchNearbyPlaces({ query });
    expect(result.success).toBe(false);
    expect((result.toolOutput as Record<string, unknown>).reason)
      .toBe("wedding_vendor_query_blocked");
  });
});

describe("모델이 받을 수 있는 도구 목록", () => {
  it("장소 검색이 목록에 있다", () => {
    expect(BETA_SAFE_TOOLS.map((tool) => tool.name)).toContain("search_nearby_places");
  });

  it("업체 추천·예약은 여전히 빠져 있다", () => {
    const names = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    for (const blocked of [
      "search_vendors",
      "recommend_vendors",
      "get_vendor_detail",
      "check_vendor_availability",
      "create_booking",
      "cancel_booking",
      "get_my_bookings",
      "get_available_slots",
    ]) {
      expect(names.has(blocked), `${blocked} 가 열렸다`).toBe(false);
    }
  });
});
