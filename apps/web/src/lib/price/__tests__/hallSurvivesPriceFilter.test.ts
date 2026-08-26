import { describe, expect, it } from "vitest";

import {
  comparableOffers,
  filterPriceCatalog,
  type PriceOffer,
  type PriceVendor,
} from "@/lib/price/catalog";

/**
 * 예식장은 가격을 입력하면 한 곳도 안 남았다.
 *
 * ## 운영 라이브 재현 (2026-08-26)
 *
 *     /price/hall   '전체 189곳' → 최대 가격 10억 입력 → "0개 업체"
 *                                  최소 1만원 입력     → "0개 업체"
 *     /price/studio '전체 296곳' → 같은 조작           → 286곳 (정상)
 *
 * 원인은 `comparableOffers()` 가 `agencyId !== null` 인 행만 남기는 것이었다.
 * 운영 실측으로 카테고리별 대행사 없는 행의 비율:
 *
 *     hall     1,081 / 1,081  = 100.0%   ← 하나도 안 남는다
 *     studio     718 /     9  =   1.3%
 *     dress      525 /     5  =   1.0%
 *     makeup     285 /     3  =   1.1%
 *
 * 예식장은 대행사를 거치지 않으므로 구조적으로 전부 null 이다.
 *
 * ## 필터를 지우면 안 된다
 *
 * 그 필터가 막는 것은 **한 카드 안에서 단위가 섞이는 것**이다 —
 * `venuePackageOffers.test.ts` 가 고정한 루미디아 사례에서 "1벌당 30만~70만" 행이
 * 대행사 150만 단일가와 섞여 카드가 "30만원부터"라고 5배 낮게 말했다.
 *
 * 그래서 **대행사 행이 하나도 없을 때만** 원본으로 되돌린다. 섞일 상대가 없는
 * 카드는 자기 공시값끼리만 비교되므로 그 위험이 성립하지 않는다.
 */

// 픽스처는 `venuePackageOffers.test.ts` 의 것을 그대로 쓴다 — 모양을 지어내면
// 필드명이 어긋나 타입이 깨진다(처음에 그렇게 썼다가 typecheck 가 막았다).
function offer(overrides: Partial<PriceOffer> & Pick<PriceOffer, "id">): PriceOffer {
  return {
    itemName: undefined,
    agencyId: null,
    agencyName: null,
    minimumKrw: 3_000_000,
    maximumKrw: 8_000_000,
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
    category: "hall",
    regionCode: "seoul_gangnam3",
    regionCodes: ["seoul_gangnam3"],
    offers: [],
    ...overrides,
  } as PriceVendor;
}

describe("예식장이 가격 필터에서 사라지지 않는다", () => {
  it("대행사 행이 하나도 없어도 비교 대상이 남는다", () => {
    const hall = vendor({
      id: "hall-1",
      name: "예식장",
      offers: [
        offer({ id: "a", minimumKrw: 3_000_000, maximumKrw: 8_000_000 }),
        offer({ id: "b", minimumKrw: 5_000_000, maximumKrw: 12_000_000 }),
      ],
    });
    expect(comparableOffers(hall)).toHaveLength(2);
  });

  it("가격대를 넣어도 예식장이 남는다 — 라이브에서 0곳이 되던 조작", () => {
    const halls = [
      vendor({ id: "h1", name: "예식장1", offers: [offer({ id: "1", minimumKrw: 3_000_000, maximumKrw: 8_000_000 })] }),
      vendor({ id: "h2", name: "예식장2", offers: [offer({ id: "2", minimumKrw: 6_000_000, maximumKrw: 20_000_000 })] }),
    ];
    const kept = filterPriceCatalog(halls, { maximumKrw: 1_000_000_000 } as never);
    expect(kept, "가격 상한을 넣자 전부 사라졌다").toHaveLength(2);
  });
});

describe("혼합 카드는 예전 그대로 지킨다", () => {
  it("대행사 행이 있으면 대행사 없는 행은 여전히 빠진다", () => {
    // 루미디아 사례. 이게 깨지면 카드가 다시 "30만원부터"라고 5배 낮게 말한다.
    const mixed = vendor({
      id: "lumidia",
      name: "루미디아",
      category: "studio",
      offers: [
        offer({ id: "agency", agencyId: "agency-1", minimumKrw: 1_500_000, maximumKrw: 1_500_000 }),
        offer({ id: "package", agencyId: null, minimumKrw: 300_000, maximumKrw: 700_000 }),
      ],
    });
    const rows = comparableOffers(mixed);
    expect(rows).toHaveLength(1);
    expect(rows[0].agencyId).toBe("agency-1");

    const prices = rows.flatMap((r) => [r.minimumKrw, r.maximumKrw])
      .filter((v): v is number => typeof v === "number");
    expect(Math.min(...prices), "최저가가 다시 30만원이 됐다").toBe(1_500_000);
  });

  it("원본 offers 는 어느 경우에도 그대로다 — 카드에서 지우지 않는다", () => {
    const mixed = vendor({
      id: "mixed",
      name: "혼합",
      offers: [
        offer({ id: "agency", agencyId: "agency-1" }),
        offer({ id: "package", agencyId: null }),
      ],
    });
    expect(mixed.offers).toHaveLength(2);
  });
});
