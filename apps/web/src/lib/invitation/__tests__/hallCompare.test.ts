import { describe, expect, it } from "vitest";
import {
  buildCompareModel,
  buildHallCard,
  closestStationHallId,
  estimateHallTotal,
  hallBadge,
  parseHallListing,
  sortHalls,
  type HallListing,
} from "../hallCompare";
import { formatWon } from "../liveCopy";

const hall = (overrides: Partial<HallListing> = {}): HallListing => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "소담 하우스",
  region: "서울",
  areaLabel: "마포구 하우스웨딩",
  kindLabel: "하우스웨딩",
  mealPriceWon: 68_000,
  rentalFeeWon: null,
  rentalIncluded: true,
  minimumGuarantee: 180,
  stationWalkMinutes: 8,
  transitNote: "역에서 8분",
  photoUrl: null,
  sourceUrl: "https://example.com/sodam",
  checkedOn: "2026-11-14",
  active: true,
  ...overrides,
});

// 아티팩트의 세 홀(값은 예시 커플과 같다). 실제 자료가 아니라 계산 규칙을 대조하는 표본이다.
const SODAM = hall();
const GAON = hall({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "가온 웨딩홀", areaLabel: "강남구 단독홀",
  mealPriceWon: 75_000, rentalIncluded: false, rentalFeeWon: 3_000_000, minimumGuarantee: 200, stationWalkMinutes: 5, transitNote: "역에서 5분",
});
const LUCE = hall({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "루체 컨벤션", areaLabel: "영등포구 컨벤션",
  mealPriceWon: 89_000, rentalIncluded: false, rentalFeeWon: 5_000_000, minimumGuarantee: 250, stationWalkMinutes: null, transitNote: "주차 400대",
});

const BANNED = /추천|최고|가성비|저렴|1위|합리적|순위|점수|등급|보장/;

describe("hall comparison arithmetic", () => {
  it("adds the rental fee to the meal price times the larger of guests and the minimum guarantee", () => {
    expect(estimateHallTotal(SODAM, 200)).toEqual({ totalWon: 13_600_000, countedGuests: 200, minimumApplied: false });
    expect(estimateHallTotal(GAON, 200)).toEqual({ totalWon: 18_000_000, countedGuests: 200, minimumApplied: false });
    expect(estimateHallTotal(LUCE, 200)).toEqual({ totalWon: 27_250_000, countedGuests: 250, minimumApplied: true });
    expect(estimateHallTotal(hall({ minimumGuarantee: null }), 150).totalWon).toBe(10_200_000);
  });

  it("reproduces the artifact cards from the same inputs", () => {
    const cards = [SODAM, GAON, LUCE].map((item) => buildHallCard({
      hall: item, guests: 200, picked: false, closestStationId: closestStationHallId([SODAM, GAON, LUCE]), state: null,
    }));
    expect(cards.map((card) => card.totalManwon)).toEqual(["1,360", "1,800", "2,725"]);
    expect(cards.map((card) => card.meal)).toEqual(["6.8만 원", "7.5만 원", "8.9만 원"]);
    expect(cards.map((card) => card.rent)).toEqual(["식대에 포함", "300만 원", "500만 원"]);
    expect(cards.map((card) => card.minimum)).toEqual(["180명", "200명", "250명 (50명 많음)"]);
    expect(cards.map((card) => card.minimumWarn)).toEqual([false, false, true]);
    expect(cards.map((card) => card.transit)).toEqual(["역에서 8분", "역에서 5분", "주차 400대"]);
    expect(cards.map((card) => card.badge)).toEqual([null, "교통이 가장 편해요", "보증 인원 확인 필요"]);
    expect(cards[2].status).toBe("보증 인원이 50명 많아요");
  });

  it("formats won without rounding away real digits", () => {
    expect(formatWon(68_000)).toBe("6.8만 원");
    expect(formatWon(65_500)).toBe("6.55만 원");
    expect(formatWon(3_000_000)).toBe("300만 원");
    expect(formatWon(12_000_000)).toBe("1,200만 원");
    expect(formatWon(1_234_567)).toBe("1,234,567원");
    expect(formatWon(0)).toBe("0원");
  });

  it("names a station badge only for a unique shortest walk among at least two known halls", () => {
    expect(closestStationHallId([SODAM, GAON, LUCE])).toBe(GAON.id);
    expect(closestStationHallId([SODAM])).toBeNull();
    expect(closestStationHallId([SODAM, LUCE])).toBeNull();
    expect(closestStationHallId([SODAM, hall({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", stationWalkMinutes: 8 })])).toBeNull();
    // 보증 인원 확인이 교통보다 먼저다.
    expect(hallBadge(hall({ minimumGuarantee: 300, stationWalkMinutes: 1 }), 200, SODAM.id)).toBe("보증 인원 확인 필요");
  });

  it("never produces judgement words in any card string", () => {
    const variants: HallListing[] = [];
    for (const meal of [25_000, 68_000, 199_900]) {
      for (const minimum of [null, 50, 400]) {
        for (const walk of [null, 0, 15]) {
          variants.push(hall({
            id: `0000000${variants.length % 10}-0000-4000-8000-${String(variants.length).padStart(12, "0")}`,
            mealPriceWon: meal, minimumGuarantee: minimum, stationWalkMinutes: walk, transitNote: null,
            rentalIncluded: variants.length % 2 === 0, rentalFeeWon: variants.length % 2 === 0 ? null : 1_500_000,
          }));
        }
      }
    }
    for (const sort of ["total", "transit", "minimum", "mood"] as const) {
      const { compare } = buildCompareModel({
        halls: variants, guests: 200, month: 5, pickedIds: new Set([variants[0].id]), sort, states: new Map(),
        now: new Date("2026-11-17T00:00:00Z"),
      });
      for (const card of compare.halls) {
        for (const value of Object.values(card)) {
          if (typeof value === "string") expect(value).not.toMatch(BANNED);
        }
      }
    }
  });

  it("sorts only by the chosen basis and keeps unknown values last", () => {
    expect(sortHalls([LUCE, GAON, SODAM], "total", 200).map((item) => item.name)).toEqual(["소담 하우스", "가온 웨딩홀", "루체 컨벤션"]);
    expect(sortHalls([LUCE, SODAM, GAON], "transit", 200).map((item) => item.name)).toEqual(["가온 웨딩홀", "소담 하우스", "루체 컨벤션"]);
    expect(sortHalls([LUCE, GAON, SODAM], "minimum", 200).map((item) => item.name)).toEqual(["소담 하우스", "가온 웨딩홀", "루체 컨벤션"]);
    expect(sortHalls([SODAM, LUCE, GAON], "mood", 200).map((item) => item.name)).toEqual(["가온 웨딩홀", "루체 컨벤션", "소담 하우스"]);
  });

  it("states the oldest checked date and gives every hall its own source", () => {
    const { compare, sources } = buildCompareModel({
      halls: [SODAM, hall({ ...GAON, checkedOn: "2026-10-02" })], guests: 200, month: 5,
      pickedIds: new Set([SODAM.id]), sort: "total", states: new Map(), now: new Date("2026-11-17T00:00:00Z"),
    });
    expect(compare.sourceDateLabel).toBe("10월 2일");
    expect(compare.halls.map((card) => card.picked)).toEqual([true, false]);
    expect(sources.map((source) => source.sourceUrl)).toEqual(["https://example.com/sodam", "https://example.com/sodam"]);
    const lastYear = buildCompareModel({
      halls: [hall({ checkedOn: "2025-12-01" })], guests: 100, month: null, pickedIds: new Set(), sort: "total",
      states: new Map(), now: new Date("2026-11-17T00:00:00Z"),
    });
    expect(lastYear.compare.sourceDateLabel).toBe("2025년 12월 1일");
  });

  it("shows inquiry progress in the hall status line", () => {
    const card = (state: Parameters<typeof buildHallCard>[0]["state"]) =>
      buildHallCard({ hall: SODAM, guests: 200, picked: true, closestStationId: null, state }).status;
    expect(card({ dispatchStatus: "queued", reply: null })).toBe("담당자가 보내기 전에 확인하고 있어요");
    expect(card({ dispatchStatus: "sent", reply: null })).toBe("답장을 기다리고 있어요");
    expect(card({ dispatchStatus: "sent", reply: { outcome: "confirmed_time", eventAt: "2026-11-22T02:00:00Z" } })).toBe("11월 22일 상담 확정");
    expect(card({ dispatchStatus: "sent", reply: { outcome: "proposed_time", eventAt: "2026-11-21T07:00:00Z" } })).toBe("다른 시간을 제안했어요");
  });

  it("drops malformed rows at the boundary", () => {
    const base = {
      id: SODAM.id, name: "소담", region: "서울", area_label: "마포", kind_label: "하우스", meal_price_won: 68_000,
      rental_fee_won: null, rental_included: true, minimum_guarantee: 180, station_walk_minutes: 8, transit_note: null,
      photo_url: null, source_url: "https://example.com", checked_on: "2026-11-14", active: true,
    };
    expect(parseHallListing(base)).not.toBeNull();
    expect(parseHallListing({ ...base, source_url: "http://example.com" })).toBeNull();
    expect(parseHallListing({ ...base, rental_included: false, rental_fee_won: null })).toBeNull();
    expect(parseHallListing({ ...base, meal_price_won: "68000" })).toBeNull();
    expect(parseHallListing({ ...base, photo_url: "javascript:alert(1)" })?.photoUrl).toBeNull();
  });
});
