import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();

function source(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), "utf8");
}

describe("canonical official price wishlist boundary", () => {
  it("redirects both legacy favorite pages to one canonical price route", () => {
    const legacyPages = [
      source("src/app/favorites/page.tsx"),
      source("src/app/vendors/favorites/page.tsx"),
    ];

    for (const page of legacyPages) {
      expect(page).toContain('redirect("/price/wishlist")');
      expect(page).not.toContain("/api/vendors");
      expect(page).not.toContain("VendorCard");
    }

    expect(source("src/app/robots.ts")).toContain('"/price/wishlist"');
  });

  it("joins favorite IDs only to the official public price catalog", () => {
    const page = source("src/app/price/wishlist/page.tsx");
    const client = source("src/components/price/PriceWishlist.tsx");
    const combined = `${page}\n${client}`;

    expect(page).toContain("loadPublicPriceCatalog");
    expect(page).toContain("createPublicClient");
    expect(client).toContain('fetch("/api/favorites"');
    expect(client).toContain("selectOfficialWishlistedVendors");
    expect(client).toContain("PRICE_CATEGORIES");
    expect(combined).not.toContain("/api/vendors");
    expect(combined).not.toContain('.from("vendors")');
  });

  it("sets explicit favorite states instead of issuing retry-sensitive toggles", () => {
    const list = source("src/components/price/PriceExplorer.tsx");
    const detail = source("src/components/vendor-price/VendorDetailActions.tsx");
    const route = source("src/app/api/favorites/route.ts");

    for (const client of [list, detail]) {
      expect(client).toContain('method: desiredFavorite ? "POST" : "DELETE"');
      expect(client).toContain("body.isFavorite !== desiredFavorite");
    }
    expect(route).toContain("POST sets the desired state");
    expect(route).toContain("ignoreDuplicates: true");
    expect(route).not.toContain("Favorite toggle error");
  });
});
