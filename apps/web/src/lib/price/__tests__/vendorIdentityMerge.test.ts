import { describe, expect, it } from "vitest";

import { filterPriceCatalog, vendorRegionCodes, type PriceVendor } from "@/lib/price/catalog";

// 스드메 공시는 대행사별 xlsx라 같은 샵을 여러 대행사가 취급하면 가격이 갈린다.
// 그 차이가 이 서비스의 핵심 정보인데, 적재 RPC가 신원 키에 지역을 넣어
// (대행사 지역이 다르면 새 업체) 같은 샵이 여러 장으로 쪼개져 있었다.
// 목록 로더에서 (카테고리 + 정규화 이름)으로 다시 묶는다.

function vendor(overrides: Partial<PriceVendor> & Pick<PriceVendor, "id" | "name">): PriceVendor {
  return {
    slug: `slug-${overrides.id}`,
    aliases: [],
    category: "studio",
    regionCode: null,
    offers: [],
    ...overrides,
  } as PriceVendor;
}

describe("병합된 업체의 지역 처리", () => {
  it("여러 대행사 지역 중 하나만 맞아도 지역 필터에 걸린다", () => {
    const merged = vendor({
      id: "1",
      name: "디아일",
      regionCode: "seoul_etc",
      regionCodes: ["seoul_etc", "seoul_gangnam3"],
    });

    for (const region of ["seoul_etc", "seoul_gangnam3"]) {
      expect(filterPriceCatalog([merged], { regionCode: region })).toHaveLength(1);
    }
    expect(filterPriceCatalog([merged], { regionCode: "busan" })).toHaveLength(0);
  });

  it("병합 전 단일 지역 업체도 같은 방식으로 걸러진다", () => {
    const single = vendor({ id: "2", name: "벨르", regionCode: "busan" });

    expect(vendorRegionCodes(single)).toEqual(["busan"]);
    expect(filterPriceCatalog([single], { regionCode: "busan" })).toHaveLength(1);
    expect(filterPriceCatalog([single], { regionCode: "ulsan" })).toHaveLength(0);
  });

  it("지역 정보가 없는 업체는 지역 필터에서 제외된다", () => {
    const unknown = vendor({ id: "3", name: "무지역" });

    expect(vendorRegionCodes(unknown)).toEqual([]);
    expect(filterPriceCatalog([unknown], { regionCode: "busan" })).toHaveLength(0);
    // 지역을 고르지 않았다면 그대로 보인다.
    expect(filterPriceCatalog([unknown], {})).toHaveLength(1);
  });
});
