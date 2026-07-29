import { describe, expect, it } from "vitest";

import {
  formatKrwManwon,
  summarizeAgencySpread,
  vendorAgencySpreads,
} from "./agencySpread";
import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceOffer,
  type PriceVendor,
} from "./catalog";

function offer(partial: Partial<PriceOffer> & { id: string }): PriceOffer {
  return {
    itemName: "가을",
    agencyId: null,
    agencyName: "업체 직접 공시",
    minimumKrw: null,
    maximumKrw: null,
    priceNote: null,
    baseSpec: null,
    options: [],
    ...partial,
  };
}

function vendor(
  category: PriceCategory,
  name: string,
  offers: PriceOffer[],
): PriceVendor {
  return {
    id: `vendor-${name}`,
    slug: `vendor-${name}`,
    name,
    aliases: [],
    category,
    regionCode: null,
    offers,
  };
}

function catalogOf(vendors: PriceVendor[]): PriceCatalog {
  const categories = Object.fromEntries(
    PRICE_CATEGORIES.map((category) => [
      category,
      vendors.filter((entry) => entry.category === category),
    ]),
  ) as PriceCatalog["categories"];
  return {
    periodLabel: "2026Q3",
    categories,
    counts: Object.fromEntries(
      PRICE_CATEGORIES.map((category) => [category, categories[category].length]),
    ) as PriceCatalog["counts"],
    agencies: [],
  };
}

describe("vendorAgencySpreads", () => {
  it("대행사가 1곳뿐이면 비교가 성립하지 않는다", () => {
    expect(vendorAgencySpreads(vendor("studio", "가을", [
      offer({ id: "a", agencyId: "agency-1", minimumKrw: 1_490_000 }),
    ]))).toEqual([]);
  });

  it("대행사별 최저·최고와 차액을 낸다", () => {
    const [spread] = vendorAgencySpreads(vendor("studio", "가을", [
      offer({ id: "a", agencyId: "agency-1", minimumKrw: 1_090_000 }),
      offer({ id: "b", agencyId: "agency-2", minimumKrw: 1_400_000 }),
    ]));
    expect(spread).toMatchObject({
      category: "studio",
      itemLabel: null,
      lowKrw: 1_090_000,
      highKrw: 1_400_000,
      gapKrw: 310_000,
      agencyCount: 2,
    });
  });

  it("스드메의 item_name은 샵 이름이므로 표기가 달라도 한 묶음으로 본다", () => {
    // 운영 실측: 아이웨딩만 "가을스튜디오", 나머지는 "가을"로 적었다. 상품명인 줄 알고
    // 쪼개면 최저가 109만 행이 통째로 빠진다 — 첫 화면이 실제보다 좁은 차이를 말하게 된다.
    const spreads = vendorAgencySpreads(vendor("studio", "가을", [
      offer({ id: "a", agencyId: "agency-1", itemName: "가을스튜디오", minimumKrw: 1_090_000 }),
      offer({ id: "b", agencyId: "agency-2", itemName: "가을", minimumKrw: 1_240_000 }),
      offer({ id: "c", agencyId: "agency-3", itemName: "가을", minimumKrw: 1_400_000 }),
    ]));
    expect(spreads).toHaveLength(1);
    expect(spreads[0]).toMatchObject({ lowKrw: 1_090_000, highKrw: 1_400_000, agencyCount: 3, itemLabel: null });
  });

  it("공백·대소문자 표기 차이도 샵 이름으로 흡수한다", () => {
    const [spread] = vendorAgencySpreads(vendor("studio", "구호", [
      offer({ id: "a", agencyId: "agency-1", itemName: "구호 스튜디오", minimumKrw: 1_000_000 }),
      offer({ id: "b", agencyId: "agency-2", itemName: "구호", minimumKrw: 1_390_000 }),
    ]));
    expect(spread).toMatchObject({ agencyCount: 2, gapKrw: 390_000, itemLabel: null });
  });

  it("예식장처럼 item_name이 진짜 상품이면 상품별로 나눠 비교한다", () => {
    // 식대와 대관료를 맞대면 안 된다.
    const spreads = vendorAgencySpreads(vendor("hall", "아름다운컨벤션", [
      offer({ id: "a", agencyId: "agency-1", itemName: "비스타홀 식대", minimumKrw: 60_000 }),
      offer({ id: "b", agencyId: "agency-2", itemName: "비스타홀 식대", minimumKrw: 75_000 }),
      offer({ id: "c", agencyId: "agency-1", itemName: "비스타홀 대관료", minimumKrw: 3_000_000 }),
      offer({ id: "d", agencyId: "agency-2", itemName: "비스타홀 대관료", minimumKrw: 3_000_000 }),
    ]));
    expect(spreads).toHaveLength(2);
    expect(spreads[0]).toMatchObject({ itemLabel: "비스타홀 식대", lowKrw: 60_000, highKrw: 75_000 });
    expect(spreads[1]).toMatchObject({ itemLabel: "비스타홀 대관료", gapKrw: 0 });
  });

  it("한 대행사가 여러 행을 올리면 그 대행사의 최저가만 비교에 쓴다", () => {
    const [spread] = vendorAgencySpreads(vendor("dress", "르블랑", [
      offer({ id: "a", agencyId: "agency-1", itemName: "르블랑", minimumKrw: 800_000 }),
      offer({ id: "b", agencyId: "agency-1", itemName: "르블랑", minimumKrw: 2_000_000 }),
      offer({ id: "c", agencyId: "agency-2", itemName: "르블랑", minimumKrw: 1_500_000 }),
    ]));
    expect(spread).toMatchObject({ lowKrw: 800_000, highKrw: 1_500_000, agencyCount: 2 });
  });

  it("한 대행사만 여러 행을 올린 경우는 비교 대상이 아니다", () => {
    expect(vendorAgencySpreads(vendor("dress", "르블랑", [
      offer({ id: "a", agencyId: "agency-1", itemName: "르블랑", minimumKrw: 800_000 }),
      offer({ id: "b", agencyId: "agency-1", itemName: "르블랑", minimumKrw: 2_000_000 }),
    ]))).toEqual([]);
  });

  it("가격이 없거나 0 이하인 행은 세지 않는다", () => {
    expect(vendorAgencySpreads(vendor("makeup", "치치라보", [
      offer({ id: "a", agencyId: "agency-1", itemName: "치치라보", minimumKrw: null }),
      offer({ id: "b", agencyId: "agency-2", itemName: "치치라보", minimumKrw: 0 }),
      offer({ id: "c", agencyId: "agency-3", itemName: "치치라보", minimumKrw: 250_000 }),
    ]))).toEqual([]);
  });

  it("차액이 큰 묶음이 먼저 온다", () => {
    const spreads = vendorAgencySpreads(vendor("hall", "아름다운컨벤션", [
      offer({ id: "a", agencyId: "agency-1", itemName: "A홀 식대", minimumKrw: 60_000 }),
      offer({ id: "b", agencyId: "agency-2", itemName: "A홀 식대", minimumKrw: 70_000 }),
      offer({ id: "c", agencyId: "agency-1", itemName: "A홀 대관료", minimumKrw: 1_000_000 }),
      offer({ id: "d", agencyId: "agency-2", itemName: "A홀 대관료", minimumKrw: 3_000_000 }),
    ]));
    expect(spreads.map(({ itemLabel }) => itemLabel)).toEqual(["A홀 대관료", "A홀 식대"]);
  });
});

describe("summarizeAgencySpread", () => {
  it("비교 가능한 업체와 실제로 값이 달랐던 업체를 따로 센다", () => {
    const summary = summarizeAgencySpread(catalogOf([
      vendor("studio", "값같음", [
        offer({ id: "a", agencyId: "agency-1", itemName: "값같음", minimumKrw: 1_000_000 }),
        offer({ id: "b", agencyId: "agency-2", itemName: "값같음", minimumKrw: 1_000_000 }),
      ]),
      vendor("studio", "값다름", [
        offer({ id: "c", agencyId: "agency-1", itemName: "값다름", minimumKrw: 1_000_000 }),
        offer({ id: "d", agencyId: "agency-2", itemName: "값다름", minimumKrw: 1_800_000 }),
      ]),
    ]));

    expect(summary.comparableVendors).toBe(2);
    expect(summary.differingVendors).toBe(1);
  });

  it("카테고리마다 차이가 가장 큰 사례 하나씩만, 카탈로그 순서로 낸다", () => {
    const summary = summarizeAgencySpread(catalogOf([
      vendor("dress", "작은차이", [
        offer({ id: "a", agencyId: "agency-1", itemName: "작은차이", minimumKrw: 800_000 }),
        offer({ id: "b", agencyId: "agency-2", itemName: "작은차이", minimumKrw: 1_500_000 }),
      ]),
      vendor("dress", "큰차이", [
        offer({ id: "c", agencyId: "agency-1", itemName: "큰차이", minimumKrw: 800_000 }),
        offer({ id: "d", agencyId: "agency-2", itemName: "큰차이", minimumKrw: 3_000_000 }),
      ]),
      vendor("studio", "스튜디오하나", [
        offer({ id: "e", agencyId: "agency-1", itemName: "스튜디오하나", minimumKrw: 1_000_000 }),
        offer({ id: "f", agencyId: "agency-2", itemName: "스튜디오하나", minimumKrw: 1_400_000 }),
      ]),
    ]));

    expect(summary.highlights.map(({ category, gapKrw }) => [category, gapKrw])).toEqual([
      ["studio", 400_000],
      ["dress", 2_200_000],
    ]);
  });

  it("첫 화면에 업체명을 세우지 않는다 — 스드메 하이라이트의 라벨은 비어 있다", () => {
    const summary = summarizeAgencySpread(catalogOf([
      vendor("studio", "이경호포토그라피", [
        offer({ id: "a", agencyId: "agency-1", itemName: "이경호포토그라피", minimumKrw: 2_000_000 }),
        offer({ id: "b", agencyId: "agency-2", itemName: "이경호포토그라피", minimumKrw: 5_000_000 }),
      ]),
    ]));
    expect(summary.highlights[0].itemLabel).toBeNull();
  });

  it("비교할 것이 없으면 빈 요약을 낸다", () => {
    expect(summarizeAgencySpread(catalogOf([]))).toEqual({
      comparableVendors: 0,
      differingVendors: 0,
      highlights: [],
    });
  });
});

describe("formatKrwManwon", () => {
  it("만 단위로 적되 5천원을 지어내지 않는다", () => {
    expect(formatKrwManwon(1_490_000)).toBe("149만");
    expect(formatKrwManwon(1_495_000)).toBe("149.5만");
    expect(formatKrwManwon(405_000)).toBe("40.5만");
  });

  it("천 단위 구분과 억 단위를 함께 처리한다", () => {
    expect(formatKrwManwon(35_000_000)).toBe("3,500만");
    expect(formatKrwManwon(100_000_000)).toBe("1억");
    expect(formatKrwManwon(123_000_000)).toBe("1억 2,300만");
  });
});
