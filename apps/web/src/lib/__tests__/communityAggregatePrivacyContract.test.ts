import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("retired community aggregate surfaces", () => {
  it("retires vendor-tag discovery and its public page without latent data access", () => {
    for (const path of [
      "src/app/api/community/vendor-tags/route.ts",
      "src/app/api/community/vendor-tags/[name]/route.ts",
    ]) {
      const route = source(path);
      expect(route, path).toContain("vendorCatalogRetiredResponse");
      expect(route, path).not.toMatch(/createSupabaseClient|checkRateLimit|\.from\(|avg_rating|avg_base_price|vendor_products|vendor_staff/);
    }

    const page = source("src/app/(community)/community/vendor/[name]/page.tsx");
    expect(page).toContain('<PublicBetaUnavailable feature="vendor" />');
    expect(page).not.toMatch(/useParams|fetch\(|LoadState|BookingSection|vendor_products|관련 게시글/);
  });

  it("retires cohort contract, profile, room, and digest surfaces without parsing user data", () => {
    const routes = [
      "src/app/api/community/cohort/route.ts",
      "src/app/api/community/cohort/auto-assign/route.ts",
      "src/app/api/community/cohort/[id]/messages/route.ts",
      "src/app/api/community/cohort/[id]/timeline/route.ts",
      "src/app/api/community/cohort/[id]/contracts/route.ts",
      "src/app/api/community/cohort/[id]/digest/route.ts",
      "src/app/api/community/cohort/[id]/members/[userId]/report/route.ts",
      "src/app/api/community/profile/wedding-date/route.ts",
      "src/app/api/community/profiles/[userId]/route.ts",
    ];

    for (const path of routes) {
      const route = source(path);
      expect(route, path).toContain("cohortRoomsRetiredResponse");
      expect(route, path).not.toMatch(/createAdminClient|createClientFromRequest|req\.json|request\.json|\.from\(|cohort_members|cohort_contracts|checkRateLimit/);
    }

    for (const path of [
      "src/app/(community)/community/cohort/page.tsx",
      "src/app/(community)/community/cohort/[id]/page.tsx",
      "../mobile/app/community/cohort-discovery.tsx",
      "../mobile/app/community/cohort/[id].tsx",
    ]) {
      const page = source(path);
      expect(page, path).toContain('PublicBetaUnavailable feature="cohort"');
      expect(page, path).not.toMatch(/supabase|fetch\(|cohort_members|cohort_contracts|member_count|avg_base_price/);
    }
  });
});
