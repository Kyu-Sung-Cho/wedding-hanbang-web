import { describe, expect, it } from "vitest";

import { fillPlaceKindForFamilyMeeting } from "@/lib/ai/tools/placeSearchTools";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 상견례 장소를 찾아 달라는 요청에서 두 가지가 어긋나 있었다.
 *
 * ## 1. 음식 종류가 없으면 검색이 무너진다
 *
 * 네이버 지역 검색은 키워드 매칭이다. 2026-08-25 운영 키로 직접 재본 값:
 *
 *     "공덕 상견례"    → 을밀대(냉면) · 모연(소고기구이) · 아소정(냉면)
 *     "강남역 상견례"  → 딘타이펑(중식) · 바바인디아(인도음식) · 도원참치(생선회)
 *     "상견례 장소"    → 성심당 · 이성당 · 씨엘비베이커리   ← 전부 베이커리
 *
 * 종류를 붙이면 곧바로 제자리를 찾는다:
 *
 *     "공덕 상견례 한정식"    → 한식 5/5
 *     "강남역 상견례 한정식"  → 한정식 5/5
 *
 * 반대로 `상견례` 라는 낱말 자체를 더하는 것은 값이 없었다(강남역 +1, 판교 −1,
 * 공덕 0). 그래서 그건 하지 않는다.
 *
 * ## 2. 아모라가 무엇을 확인하라고 할지 프롬프트에 없었다
 *
 * 이 도구는 프롬프트에 설명이 한 줄도 없었다. 라이브에서 "방 크기·소음·화장실"
 * 안내가 붙은 적이 있는데 그건 모델이 그때 지어낸 것이라 **다음에도 나온다는
 * 보장이 없었다.** 상견례 자리에서 룸 여부는 있으면 좋은 정보가 아니라 자리가
 * 되느냐 마느냐다.
 */

const READ_ONLY_BETA_TOOLS = BETA_SAFE_TOOLS
  .map((tool) => tool.name)
  .filter((name) => !isMutatingTool(name));

describe("상견례 검색어에 음식 종류를 채운다", () => {
  it.each([
    ["공덕 상견례", "공덕 상견례 한정식"],
    ["강남역 상견례", "강남역 상견례 한정식"],
    ["상견례 장소", "상견례 장소 한정식"],
  ])("'%s' → '%s'", (input, expected) => {
    expect(fillPlaceKindForFamilyMeeting(input)).toBe(expected);
  });

  it.each([
    "공덕 상견례 한정식",
    "강남역 상견례 한식",
    "판교 상견례 일식",
    "여의도 상견례 중식",
  ])("이미 종류를 말했으면 건드리지 않는다: '%s'", (input) => {
    expect(fillPlaceKindForFamilyMeeting(input)).toBeNull();
  });

  it.each([
    "강남역 상견례 초밥집",
    "공덕 상견례 갈비",
    "판교 상견례 스테이크",
  ])("다른 음식을 말했어도 존중한다: '%s'", (input) => {
    // 중식당에서 하겠다는 사람에게 한정식을 밀어 넣으면 도움이 아니다.
    expect(fillPlaceKindForFamilyMeeting(input)).toBeNull();
  });

  it.each([
    "홍대 밥 먹을 곳",
    "판교 한정식",
    "강남 카페",
  ])("상견례가 아니면 손대지 않는다: '%s'", (input) => {
    expect(fillPlaceKindForFamilyMeeting(input)).toBeNull();
  });
});

describe("아모라가 매번 무엇을 확인하라고 말한다", () => {
  const prompt = buildAmoraSystemPrompt(
    {
      weddingDate: "2027-05-15", budget: 62_000_000, venue: null, progress: {},
      preparationStatus: null, brideName: "신부", groomName: "신랑",
      bookings: [], scheduleEvents: [], chatSummaries: [],
      pastConflicts: [], pastDecisions: [],
    } as never,
    {
      requestKind: "chat",
      persistenceMode: "durable",
      // 운영이 실제로 주는 목록. 이 도구는 읽기라 여기 실린다.
      enabledToolNames: READ_ONLY_BETA_TOOLS,
    },
  );

  it("이 도구가 운영에서 실제로 열린다 — 전제 확인", () => {
    expect(READ_ONLY_BETA_TOOLS).toContain("search_nearby_places");
  });

  it.each(["독립된 룸", "좌식", "최소 인원", "주차"])(
    "%s 확인을 알려준다",
    (item) => {
      expect(prompt).toContain(item);
    },
  );

  it("예약이 아니라고 분명히 말한다", () => {
    expect(prompt).toContain("예약이 아닙니다");
    expect(prompt).toContain("자리를 잡아 주거나 확정해 주지 않습니다");
  });

  it("검색 결과에 없는 것을 아는 척하지 말라고 한다", () => {
    // 네이버는 이름·분류·주소·전화만 준다. 룸 정보는 애초에 없다.
    expect(prompt).toContain("결과에 없는 것을 아는 척하지 마세요");
  });

  it("검색 순서를 품질로 말하지 말라고 한다", () => {
    expect(prompt).toContain("순서·평점·리뷰 수를 품질로 말하지 마세요");
  });
});
