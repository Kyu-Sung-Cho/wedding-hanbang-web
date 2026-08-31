import { describe, expect, it } from "vitest";

import { filterPriceCatalog, pricePolicyBadgeClass, type PriceVendor } from "./catalog";

function vendor(
  id: string,
  name: string,
  aliases: string[],
  minimum: number,
): PriceVendor {
  return {
    id,
    slug: `sample-${id}`,
    name,
    aliases,
    category: "studio",
    regionCode: "seoul_gangnam3",
    offers: [{
      id: `offer-${id}`,
      agencyId: `agency-${id}`,
      agencyName: `샘플 대행사 ${id}`,
      minimumKrw: minimum,
      maximumKrw: minimum,
      priceNote: null,
      baseSpec: null,
      options: [],
    }],
  };
}

describe("filterPriceCatalog", () => {
  it("finds a vendor by current name or old alias and keeps Korean name order", () => {
    const vendors = [
      vendor("2", "샘플 봄 스튜디오", ["구. 샘플 햇살"], 1_300_000),
      vendor("1", "샘플 가을 스튜디오", ["샘플 옛이름"], 1_100_000),
    ];

    expect(filterPriceCatalog(vendors, { search: "옛이름" }).map(({ id }) => id))
      .toEqual(["1"]);
    expect(filterPriceCatalog(vendors, { search: "샘플" }).map(({ id }) => id))
      .toEqual(["1", "2"]);
  });

  it("combines region, agency, base-price and wishlist filters before sorting by lowest price", () => {
    const first = vendor("1", "샘플 하나", [], 1_100_000);
    const second = {
      ...vendor("2", "샘플 둘", [], 900_000),
      regionCode: "busan",
      offers: [{ ...vendor("2", "샘플 둘", [], 900_000).offers[0], agencyId: "agency-b" }],
    } satisfies PriceVendor;
    const third = {
      ...vendor("3", "샘플 셋", [], 1_400_000),
      offers: [{ ...vendor("3", "샘플 셋", [], 1_400_000).offers[0], agencyId: "agency-b" }],
    } satisfies PriceVendor;
    const vendors = [first, second, third];

    expect(filterPriceCatalog(vendors, {
      regionCode: "seoul_gangnam3",
      agencyIds: ["agency-b"],
      minimumKrw: 1_200_000,
      maximumKrw: 1_500_000,
      wishlistOnly: true,
      wishlistedIds: new Set(["3"]),
      sort: "lowest_price",
    }).map(({ id }) => id)).toEqual(["3"]);

    expect(filterPriceCatalog(vendors, { sort: "lowest_price" }).map(({ id }) => id))
      .toEqual(["2", "1", "3"]);
  });

  it("keeps only the selected region's disclosed offers on a merged vendor", () => {
    const merged = {
      ...vendor("1", "여러 지역 스튜디오", [], 1_100_000),
      regionCode: "seoul_gangnam3",
      regionCodes: ["seoul_gangnam3", "gangwon"],
      offers: [
        {
          ...vendor("1", "여러 지역 스튜디오", [], 1_100_000).offers[0],
          id: "offer-seoul",
          regionCode: "seoul_gangnam3",
        },
        {
          ...vendor("1", "여러 지역 스튜디오", [], 1_400_000).offers[0],
          id: "offer-gangwon",
          regionCode: "gangwon",
        },
      ],
    } satisfies PriceVendor;

    const seoulOnly = {
      ...vendor("2", "서울 전용 스튜디오", [], 900_000),
      regionCode: "seoul_gangnam3",
      regionCodes: ["seoul_gangnam3"],
      offers: [{
        ...vendor("2", "서울 전용 스튜디오", [], 900_000).offers[0],
        id: "offer-seoul-only",
        regionCode: "seoul_gangnam3",
      }],
    } satisfies PriceVendor;

    const results = filterPriceCatalog([merged, seoulOnly], { regionCode: "gangwon" });
    const [result] = results;

    expect(results).toHaveLength(1);
    expect(result?.offers.map(({ id }) => id)).toEqual(["offer-gangwon"]);
    expect(result?.regionCode).toBe("gangwon");
    expect(result?.regionCodes).toEqual(["gangwon"]);
  });
});

describe("pricePolicyBadgeClass", () => {
  it("reserves danger styling for penalties and keeps other policy types calm", () => {
    expect(pricePolicyBadgeClass("penalty")).toContain("danger");
    expect(pricePolicyBadgeClass("refund")).toContain("sage");
    expect(pricePolicyBadgeClass("change")).toContain("gold");
    expect(pricePolicyBadgeClass("other")).toContain("--hb-surface-hover");
    expect([
      pricePolicyBadgeClass("refund"),
      pricePolicyBadgeClass("change"),
      pricePolicyBadgeClass("other"),
    ]).not.toContain(pricePolicyBadgeClass("penalty"));
  });
});
