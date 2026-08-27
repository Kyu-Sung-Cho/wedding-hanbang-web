import { describe, expect, it } from "vitest";

import {
  PRICE_CATEGORIES,
  vendorRegionCodes,
  type PriceCatalog,
  type PriceVendor,
} from "../catalog";
import { PRICE_REGION_OPTIONS } from "../labels";

type RegionSummary = { code: string; label: string; count: number };

function buildCrossRegionCounts(catalog: PriceCatalog): RegionSummary[] {
  const tally = new Map<string, number>();
  for (const category of PRICE_CATEGORIES) {
    for (const vendor of catalog.categories[category]) {
      for (const code of new Set(vendorRegionCodes(vendor))) {
        tally.set(code, (tally.get(code) ?? 0) + 1);
      }
    }
  }
  return PRICE_REGION_OPTIONS
    .map(([code, label]) => ({ code, label, count: tally.get(code) ?? 0 }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count);
}

function vendor(id: string, category: "studio" | "dress" | "makeup" | "hall", regionCode: string | null = null): PriceVendor {
  return {
    id,
    slug: id,
    name: `테스트 업체 ${id}`,
    aliases: [],
    category,
    regionCode,
    regionCodes: regionCode ? [regionCode] : [],
    offers: [],
  };
}

describe("buildCrossRegionCounts", () => {
  it("counts vendors by region across all categories", () => {
    const catalog: PriceCatalog = {
      periodLabel: "2026Q3",
      categories: {
        studio: [
          vendor("s1", "studio", "seoul_gangnam3"),
          vendor("s2", "studio", "seoul_gangnam3"),
          vendor("s3", "studio", "gangwon"),
        ],
        dress: [
          vendor("d1", "dress", "seoul_gangnam3"),
          vendor("d2", "dress", "gyeonggi"),
        ],
        makeup: [],
        hall: [],
      },
      counts: { studio: 3, dress: 2, makeup: 0, hall: 0 },
      agencies: [],
    };

    const counts = buildCrossRegionCounts(catalog);

    expect(counts[0]).toEqual({ code: "seoul_gangnam3", label: "서울 강남권", count: 3 });
    expect(counts.find((r) => r.code === "gangwon")).toEqual({ code: "gangwon", label: "강원", count: 1 });
    expect(counts.find((r) => r.code === "gyeonggi")).toEqual({ code: "gyeonggi", label: "경기", count: 1 });
    expect(counts).toHaveLength(3);
  });

  it("counts vendors with multiple regions in each region", () => {
    const multiRegionVendor: PriceVendor = {
      ...vendor("multi", "studio", "seoul_gangnam3"),
      regionCodes: ["seoul_gangnam3", "gangwon", "busan"],
    };
    const catalog: PriceCatalog = {
      periodLabel: "2026Q3",
      categories: {
        studio: [multiRegionVendor],
        dress: [],
        makeup: [],
        hall: [],
      },
      counts: { studio: 1, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    };

    const counts = buildCrossRegionCounts(catalog);

    expect(counts).toHaveLength(3);
    expect(counts.every((r) => r.count === 1)).toBe(true);
    expect(counts.map((r) => r.code).sort()).toEqual(["busan", "gangwon", "seoul_gangnam3"]);
  });

  it("excludes regions with zero vendors", () => {
    const catalog: PriceCatalog = {
      periodLabel: "2026Q3",
      categories: {
        studio: [vendor("s1", "studio", "seoul_gangnam3")],
        dress: [],
        makeup: [],
        hall: [],
      },
      counts: { studio: 1, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    };

    const counts = buildCrossRegionCounts(catalog);

    expect(counts).toHaveLength(1);
    expect(counts[0].code).toBe("seoul_gangnam3");
  });

  it("handles vendors with no region code", () => {
    const catalog: PriceCatalog = {
      periodLabel: "2026Q3",
      categories: {
        studio: [vendor("noregion", "studio", null)],
        dress: [],
        makeup: [],
        hall: [],
      },
      counts: { studio: 1, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    };

    const counts = buildCrossRegionCounts(catalog);

    expect(counts).toHaveLength(0);
  });

  it("sorts regions by count descending", () => {
    const catalog: PriceCatalog = {
      periodLabel: "2026Q3",
      categories: {
        studio: [
          vendor("s1", "studio", "gangwon"),
          vendor("s2", "studio", "seoul_gangnam3"),
          vendor("s3", "studio", "seoul_gangnam3"),
          vendor("s4", "studio", "seoul_gangnam3"),
        ],
        dress: [
          vendor("d1", "dress", "gangwon"),
        ],
        makeup: [],
        hall: [],
      },
      counts: { studio: 4, dress: 1, makeup: 0, hall: 0 },
      agencies: [],
    };

    const counts = buildCrossRegionCounts(catalog);

    expect(counts[0].code).toBe("seoul_gangnam3");
    expect(counts[0].count).toBe(3);
    expect(counts[1].code).toBe("gangwon");
    expect(counts[1].count).toBe(2);
  });
});
