import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_VENDOR_COLUMNS,
  PUBLIC_VENDOR_REVIEW_COLUMNS,
} from "../publicFields";

const webRoot = process.cwd();

function source(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), "utf8");
}

describe("public vendor data boundary", () => {
  it("never selects every vendor or review column in public web routes", () => {
    const listRoute = source("src/app/api/vendors/route.ts");
    const detailRoute = source("src/app/api/vendors/[id]/route.ts");
    const legacyFavoritesPage = source("src/app/favorites/page.tsx");
    const priceWishlistPage = source("src/app/price/wishlist/page.tsx");
    const priceWishlistClient = source("src/components/price/PriceWishlist.tsx");

    expect(listRoute).not.toContain('.from("vendors")\n      .select("*")');
    expect(detailRoute).not.toContain('.from("vendors")\n      .select("*")');
    expect(detailRoute).not.toContain('.from("vendor_reviews")\n      .select("*")');
    expect(legacyFavoritesPage).toContain('redirect("/price/wishlist")');
    expect(priceWishlistPage).toContain("loadPublicPriceCatalog");
    expect(priceWishlistClient).toContain('fetch("/api/favorites"');
    for (const wishlistSource of [legacyFavoritesPage, priceWishlistPage, priceWishlistClient]) {
      expect(wishlistSource).not.toContain('.select("*")');
      expect(wishlistSource).not.toContain('.from("vendors")');
      expect(wishlistSource).not.toContain("/api/vendors");
    }
  });

  it("serves remaining public vendor API reads through a server allow-list", () => {
    const listRoute = source("src/app/api/vendors/route.ts");
    const detailRoute = source("src/app/api/vendors/[id]/route.ts");

    expect(listRoute).toContain("createAdminClient");
    expect(listRoute).not.toContain("createClientFromRequest");
    expect(detailRoute).toContain("const admin = createAdminClient()");
    expect(detailRoute).toContain("const userClient = await createClientFromRequest(req)");
    for (const route of [listRoute, detailRoute]) {
      expect(route).toContain("PUBLIC_VENDOR_COLUMNS");
      expect(route).toContain('.eq("status", "approved")');
      expect(route).toContain('admin\n      .from("vendors")');
    }
  });

  it("keeps customer-session vendor base reads behind server-owned lookups", () => {
    const customerSurfaces = [
      "src/app/favorites/page.tsx",
      "src/app/api/bookings/route.ts",
      "src/app/api/bookings/mine/route.ts",
      "src/app/api/chat/route.ts",
      "src/app/api/community/posts/[id]/route.ts",
      "src/app/api/favorites/route.ts",
      "src/app/api/messages/threads/route.ts",
      "src/app/api/vendors/[id]/staff/route.ts",
    ].map(source).join("\n");

    expect(customerSurfaces).not.toMatch(/\b(?:supabase|userClient)\s*\.from\("vendors"\)/);
    expect(customerSurfaces).toContain("createAdminClient");
  });

  it("keeps vendor ownership predicates behind the server service boundary", () => {
    const messageRoutes = [
      source("src/app/api/messages/route.ts"),
      source("src/app/api/messages/threads/route.ts"),
    ].join("\n");

    expect(messageRoutes).not.toContain('.eq("owner_id"');
    expect(messageRoutes).toContain("loadOwnedVendorWithServiceRole");
  });

  it("keeps private vendor and reviewer identity columns outside allow-lists", () => {
    const vendorColumns = PUBLIC_VENDOR_COLUMNS.split(",");
    const reviewColumns = PUBLIC_VENDOR_REVIEW_COLUMNS.split(",");

    expect(vendorColumns).toContain("is_verified");
    expect(vendorColumns).not.toEqual(expect.arrayContaining([
      "owner_id",
      "owner_name",
      "email",
      "business_number",
      "business_license_url",
      "commission_rate",
      "bank_name",
      "account_number",
      "account_holder",
      "notification_settings",
    ]));
    expect(reviewColumns).not.toEqual(expect.arrayContaining([
      "customer_id",
      "booking_id",
    ]));
  });

  it("keeps web and mobile discovery on one canonical disclosure surface", () => {
    const publicWebListPath = "src/app/vendors/page.tsx";
    const guardedWebListPath = "src/app/(app)/vendors/page.tsx";
    const webList = source(publicWebListPath);
    const publicWebDetailPath = "src/app/vendors/[id]/page.tsx";
    const guardedWebDetailPath = "src/app/(app)/vendors/[id]/page.tsx";
    const webDetail = source(publicWebDetailPath);
    const mobileList = readFileSync(
      resolve(webRoot, "../mobile/app/vendors/index.tsx"),
      "utf8",
    );
    const mobileDetail = readFileSync(
      resolve(webRoot, "../mobile/app/vendors/[id].tsx"),
      "utf8",
    );

    expect(webList).toContain('redirect("/price/studio")');
    expect(existsSync(resolve(webRoot, publicWebListPath))).toBe(true);
    expect(existsSync(resolve(webRoot, guardedWebListPath))).toBe(false);
    expect(existsSync(resolve(webRoot, publicWebDetailPath))).toBe(true);
    expect(existsSync(resolve(webRoot, guardedWebDetailPath))).toBe(false);
    expect(webDetail).toContain('.from("v_public_official_prices")');
    expect(webDetail).toContain('.from("v_public_vendors")');
    expect(webDetail).toContain('`/price/vendor/${encodeURIComponent(published.data.vendor_slug)}`');
    expect(webDetail).toContain('`/price/${priceCategory(publicVendor.data?.category ?? null)}`');
    expect(mobileList).toContain('Redirect href="/market-prices"');
    expect(mobileDetail).toContain('Redirect href="/market-prices"');
    for (const legacySurface of [webList, webDetail, mobileList, mobileDetail]) {
      expect(legacySurface).not.toContain("/api/vendors");
      expect(legacySurface).not.toContain("business_license_url");
      expect(legacySurface).not.toContain("price_range");
      expect(legacySurface).not.toContain("ai_recommend");
    }
  });

  it("keeps the hosted-staging RLS receipt fail-closed across disclosure boundaries", () => {
    const probe = readFileSync(
      resolve(webRoot, "../../scripts/vendor-public-rls-probe.mjs"),
      "utf8",
    );

    expect(probe).toContain("VENDOR_DISCLOSURE_BASE_TABLES");
    expect(probe).toContain('"vendors"');
    expect(probe).toContain('"official_prices"');
    expect(probe).toContain('"v_public_vendors"');
    expect(probe).toContain('"v_public_prices"');
    for (const ownedTable of [
      "vendor_favorites",
      "wishlists",
      "combos",
      "price_alerts",
    ]) {
      expect(probe).toContain(`"${ownedTable}"`);
    }
    expect(probe).toContain("SUPABASE_STAGING_PROJECT_REF");
    expect(probe).toContain("RLS_PROBE_EXPECTED_COMMIT");
    expect(probe).toContain("RLS_PROBE_EXPECTED_SUCCESSOR_MIGRATION_SET_SHA256");
    expect(probe).toContain("PRODUCTION_TARGET_FORBIDDEN");
    expect(probe).toContain("CROSS_USER_ROW_EXPOSED");
    expect(probe).toContain("deploymentAuthorization: false");
  });

  it("does not present profile completeness or heuristics as trust verification", () => {
    const webList = source("src/components/price/PriceExplorer.tsx");
    const webDetail = source("src/app/price/vendor/[slug]/page.tsx");
    const disclosure = source("src/lib/price/period.ts");
    const mobileList = readFileSync(
      resolve(webRoot, "../mobile/app/vendors/index.tsx"),
      "utf8",
    );
    const mobileDetail = readFileSync(
      resolve(webRoot, "../mobile/app/vendors/[id].tsx"),
      "utf8",
    );
    const published = [webList, webDetail, mobileList, mobileDetail].join("\n");

    for (const misleadingLabel of [
      "AI 맞춤 추천",
      "딱 맞는 업체 3곳",
      "믿을 수 있는 업체만 엄선",
      "신뢰 높음",
      "검증됨",
      "추천순은 검증",
      "검증된 업체를 불러오고 있어요",
    ]) {
      expect(published).not.toContain(misleadingLabel);
    }

    expect(disclosure).toContain("가격 출처: 한국소비자원 참가격");
    expect(disclosure).toContain("계약 전 업체에 직접 확인하세요");
    expect(webDetail).toContain("계약 전 업체에 직접 확인하세요");
    expect(webDetail).toContain("공시 가격 FAQ");
    expect(webDetail).toContain("PRICE_DISCLOSURE_FAQ_MAIN_ENTITY.map");
  });
});
