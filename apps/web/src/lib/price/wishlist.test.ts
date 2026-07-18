import { describe, expect, it } from "vitest";

import type { PriceCatalog, PriceVendor } from "./catalog";
import { selectOfficialWishlistedVendors } from "./wishlist";

function vendor(id: string, category: PriceVendor["category"]): PriceVendor {
  return {
    id,
    slug: `${category}-${id}`,
    name: `${category}-${id}`,
    aliases: [],
    category,
    regionCode: null,
    offers: [],
  };
}

const catalog: PriceCatalog = {
  periodLabel: "2026Q3",
  categories: {
    studio: [vendor("studio-a", "studio"), vendor("studio-b", "studio")],
    dress: [vendor("dress-a", "dress")],
    makeup: [vendor("makeup-a", "makeup")],
    hall: [vendor("hall-a", "hall")],
  },
  counts: { studio: 2, dress: 1, makeup: 1, hall: 1 },
  agencies: [],
};

describe("official price wishlist selection", () => {
  it("returns only official catalog vendors and keeps all four category groups", () => {
    const groups = selectOfficialWishlistedVendors(catalog, [
      "legacy-private-vendor",
      "hall-a",
      "studio-b",
    ]);

    expect(groups.map(({ category }) => category)).toEqual([
      "studio",
      "dress",
      "makeup",
      "hall",
    ]);
    expect(groups.map(({ vendors }) => vendors.map(({ id }) => id))).toEqual([
      ["studio-b"],
      [],
      [],
      ["hall-a"],
    ]);
    expect(groups.flatMap(({ vendors }) => vendors).some(({ id }) => id === "legacy-private-vendor"))
      .toBe(false);
  });
});
