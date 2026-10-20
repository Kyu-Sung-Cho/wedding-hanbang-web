import { describe, expect, it } from "vitest";

import { findBudgetCombinations } from "./budgetFinder";
import type { PriceCategory, PriceVendor } from "./catalog";

function candidate(category: PriceCategory, index: number, minimumKrw: number): PriceVendor {
  return {
    id: `${category}-${index}`,
    slug: `sample-${category}-${index}`,
    name: `샘플 ${category} ${index}`,
    aliases: [],
    category,
    regionCode: "seoul_etc",
    offers: [{
      id: `${category}-offer-${index}`,
      agencyId: index % 2 === 0 ? "agency-even" : "agency-odd",
      agencyName: index % 2 === 0 ? "샘플 짝수 대행사" : "샘플 홀수 대행사",
      minimumKrw,
      maximumKrw: minimumKrw,
      priceNote: null,
      baseSpec: null,
      options: [],
    }],
  };
}

describe("findBudgetCombinations", () => {
  it("returns the cheapest feasible combinations first without exceeding the budget", () => {
    const results = findBudgetCombinations({
      catalogs: {
        studio: [candidate("studio", 0, 1_000_000), candidate("studio", 1, 1_300_000)],
        dress: [candidate("dress", 0, 800_000), candidate("dress", 1, 1_100_000)],
        makeup: [candidate("makeup", 0, 500_000), candidate("makeup", 1, 700_000)],
      },
      budgetMaximumKrw: 2_800_000,
      limit: 20,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].totalKrw).toBe(2_300_000);
    expect(results.every(({ totalKrw }) => totalKrw <= 2_800_000)).toBe(true);
    expect(results.map(({ totalKrw }) => totalKrw))
      .toEqual([...results.map(({ totalKrw }) => totalKrw)].sort((a, b) => a - b));
  });

  it("applies an agency filter before choosing each vendor's cheapest offer", () => {
    const results = findBudgetCombinations({
      catalogs: {
        studio: [candidate("studio", 0, 1_000_000), candidate("studio", 1, 700_000)],
        dress: [candidate("dress", 0, 800_000), candidate("dress", 1, 600_000)],
        makeup: [candidate("makeup", 0, 500_000), candidate("makeup", 1, 400_000)],
      },
      budgetMaximumKrw: 3_000_000,
      agencyIds: ["agency-even"],
    });

    expect(results).toHaveLength(1);
    expect([results[0].studio, results[0].dress, results[0].makeup]
      .every(({ agencyId }) => agencyId === "agency-even")).toBe(true);
  });

  it("keeps studio, dress, and makeup within the same agency when sameAgencyOnly is enabled", () => {
    const results = findBudgetCombinations({
      catalogs: {
        studio: [candidate("studio", 0, 1_000_000), candidate("studio", 1, 700_000)],
        dress: [candidate("dress", 0, 800_000), candidate("dress", 1, 900_000)],
        makeup: [candidate("makeup", 0, 500_000), candidate("makeup", 1, 400_000)],
      },
      budgetMaximumKrw: 3_000_000,
      sameAgencyOnly: true,
    });

    expect(results).toHaveLength(2);
    expect(results[0].totalKrw).toBe(2_000_000);
    expect(results[1].totalKrw).toBe(2_300_000);
    for (const combo of results) {
      expect(combo.studio.agencyId).not.toBeNull();
      expect(combo.dress.agencyId).toBe(combo.studio.agencyId);
      expect(combo.makeup.agencyId).toBe(combo.studio.agencyId);
    }
  });

  it("returns at most twenty results from 200 vendors per category within 200ms", () => {
    const catalogs = {
      studio: Array.from({ length: 200 }, (_, index) => candidate("studio", index, 900_000 + index * 1_000)),
      dress: Array.from({ length: 200 }, (_, index) => candidate("dress", index, 700_000 + index * 1_000)),
      makeup: Array.from({ length: 200 }, (_, index) => candidate("makeup", index, 400_000 + index * 1_000)),
    };
    const startedAt = performance.now();
    const results = findBudgetCombinations({
      catalogs,
      budgetMaximumKrw: 4_000_000,
    });
    const elapsed = performance.now() - startedAt;

    expect(results).toHaveLength(20);
    expect(elapsed).toBeLessThan(200);
  });
});
