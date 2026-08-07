import { describe, expect, it } from "vitest";

import {
  comparableOffers,
  filterPriceCatalog,
  type PriceOffer,
  type PriceVendor,
} from "@/lib/price/catalog";
import { findBudgetCombinations } from "@/lib/price/budgetFinder";

/**
 * 대행사 없는 행(예식장 공시에서 온 패키지 구성)이 가격 주장에 섞이지 않게 잠근다.
 *
 * 실측(2026-08-07 운영 17행): 이 행들은 단위가 다르다.
 *   루미디아          "1벌당 30만~70만" 추가금 — 대행사 6곳은 전부 150만 단일가.
 *                    섞으면 카드가 "30만원부터"라고 주장한다(실제와 5배 차이).
 *   그가사랑하는순간   "스드메 280만 패키지"(스튜디오+드레스+메이크업 합계)가
 *                    스튜디오 단품가로 들어와 최고가를 부풀린다.
 * 지우지 않고 비교 축에서만 뺀다 — 공시된 사실이라 카드엔 계속 보여야 한다.
 */
function offer(overrides: Partial<PriceOffer> & Pick<PriceOffer, "id">): PriceOffer {
  return {
    itemName: undefined,
    agencyId: "agency-1",
    agencyName: "어느대행사",
    minimumKrw: 1_500_000,
    maximumKrw: 1_500_000,
    priceNote: null,
    baseSpec: null,
    options: [],
    ...overrides,
  } as PriceOffer;
}

function vendor(overrides: Partial<PriceVendor> & Pick<PriceVendor, "id" | "name">): PriceVendor {
  return {
    slug: `slug-${overrides.id}`,
    aliases: [],
    category: "dress",
    regionCode: "busan",
    regionCodes: ["busan"],
    offers: [],
    ...overrides,
  } as PriceVendor;
}

/** 실제 운영 데이터를 본뜬 루미디아. 대행사 6곳 150만 단일가 + 예식장 1벌당 추가금. */
function lumidia(): PriceVendor {
  return vendor({
    id: "lumidia",
    name: "루미디아",
    offers: [
      ...["더리본", "더블유웨딩", "웨딩파티플랜", "린하람웨딩", "더파티플러스", "W웨딩울산"]
        .map((name, index) => offer({
          id: `agency-offer-${index}`,
          agencyId: `agency-${index}`,
          agencyName: name,
          minimumKrw: 1_500_000,
          maximumKrw: 1_500_000,
        })),
      offer({
        id: "venue-offer",
        agencyId: null,
        agencyName: "대행사를 거치지 않은 공시",
        minimumKrw: 300_000,
        maximumKrw: 700_000,
        priceNote: "스튜디오 프리미엄 드레스 샵 (1벌당 30만원~70만원 이상)",
      }),
    ],
  });
}

describe("comparableOffers", () => {
  it("대행사 없는 행을 뺀다", () => {
    const rows = comparableOffers(lumidia());
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.agencyId !== null)).toBe(true);
  });

  it("카드에서 지우지는 않는다 — 원본 offers는 그대로다", () => {
    // 공시된 사실이라 화면엔 계속 보여야 한다. 비교 축에서만 뺀다.
    expect(lumidia().offers).toHaveLength(7);
  });

  it("헤드라인 범위가 '30만원부터'가 되지 않는다", () => {
    const prices = comparableOffers(lumidia())
      .flatMap((row) => [row.minimumKrw, row.maximumKrw])
      .filter((value): value is number => typeof value === "number");
    expect(Math.min(...prices)).toBe(1_500_000);
    expect(Math.max(...prices)).toBe(1_500_000);
  });

  it("반대 방향도 막는다 — 스드메 합산 패키지가 단품 최고가를 부풀리지 않는다", () => {
    const studio = vendor({
      id: "geu-ga",
      name: "그가 사랑하는 순간",
      category: "studio",
      offers: [
        offer({ id: "a", agencyId: "agency-1", minimumKrw: 1_200_000, maximumKrw: 1_400_000 }),
        offer({
          id: "venue",
          agencyId: null,
          minimumKrw: 2_800_000,
          maximumKrw: 2_800_000,
          priceNote: "스드메 280만원 패키지",
        }),
      ],
    });
    const maximums = comparableOffers(studio)
      .flatMap((row) => row.maximumKrw ?? [])
      .filter((value): value is number => typeof value === "number");
    expect(Math.max(...maximums)).toBe(1_400_000);
  });
});

describe("가격대 필터·정렬", () => {
  it("예식장 추가금 때문에 저가 구간 검색에 잡히지 않는다", () => {
    // 30만~50만 드레스를 찾는 사람에게 실제 150만짜리를 보여주면 안 된다.
    const found = filterPriceCatalog([lumidia()], { minimumKrw: 300_000, maximumKrw: 500_000 });
    expect(found).toHaveLength(0);
  });

  it("실제 가격대 검색에는 정상적으로 잡힌다", () => {
    const found = filterPriceCatalog([lumidia()], { minimumKrw: 1_400_000, maximumKrw: 1_600_000 });
    expect(found).toHaveLength(1);
  });

  it("가격 필터가 없으면 그대로 보인다 — 업체가 사라지지 않는다", () => {
    expect(filterPriceCatalog([lumidia()], {})).toHaveLength(1);
  });

  it("최저가 정렬에서 예식장 추가금이 1위를 만들지 않는다", () => {
    const cheaper = vendor({
      id: "cheap",
      name: "가나다",
      offers: [offer({ id: "c", agencyId: "agency-9", minimumKrw: 900_000, maximumKrw: 900_000 })],
    });
    const sorted = filterPriceCatalog([lumidia(), cheaper], { sort: "lowest_price" });
    expect(sorted.map((value) => value.id)).toEqual(["cheap", "lumidia"]);
  });
});

describe("예산 조합", () => {
  it("살 수 없는 가격으로 추천하지 않는다", () => {
    const combos = findBudgetCombinations({
      catalogs: {
        studio: [vendor({ id: "s", name: "스튜디오A", category: "studio", offers: [offer({ id: "s1", agencyId: "agency-1", minimumKrw: 1_000_000 })] })],
        dress: [lumidia()],
        makeup: [vendor({ id: "m", name: "메이크업A", category: "makeup", offers: [offer({ id: "m1", agencyId: "agency-1", minimumKrw: 500_000 })] })],
      },
      budgetMaximumKrw: 10_000_000,
    });
    expect(combos.length).toBeGreaterThan(0);
    for (const combo of combos) {
      expect(combo.dress.baseKrw, "예식장 1벌당 추가금이 예산 조합에 들어갔다").toBe(1_500_000);
      expect(combo.dress.agencyId).not.toBeNull();
    }
  });

  it("예식장 추가금을 쓰면 잡혔을 예산에서도 안 잡힌다", () => {
    // 30만+100만+50만=180만. 추가금이 후보였다면 200만 예산에 조합이 생긴다.
    const combos = findBudgetCombinations({
      catalogs: {
        studio: [vendor({ id: "s", name: "스튜디오A", category: "studio", offers: [offer({ id: "s1", agencyId: "agency-1", minimumKrw: 1_000_000 })] })],
        dress: [lumidia()],
        makeup: [vendor({ id: "m", name: "메이크업A", category: "makeup", offers: [offer({ id: "m1", agencyId: "agency-1", minimumKrw: 500_000 })] })],
      },
      budgetMaximumKrw: 2_000_000,
    });
    expect(combos).toHaveLength(0);
  });
});
