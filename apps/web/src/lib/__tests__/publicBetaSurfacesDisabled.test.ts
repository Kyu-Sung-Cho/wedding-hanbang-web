import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("physically retired public surfaces", () => {
  it("keeps quick review out of entry points and redirects the old mobile route", () => {
    const activeEntries = [
      "apps/web/src/components/community/EmptyFeedStarter.tsx",
      "apps/web/src/components/community/MyToolsWidget.tsx",
      "apps/mobile/app/(tabs)/community.tsx",
    ];
    for (const path of activeEntries) {
      expect(read(path), path).not.toMatch(/quick-review|PUBLIC_BETA_CAPABILITIES/);
    }

    const webRoute = read("apps/web/src/app/(community)/community/quick-review/page.tsx");
    const mobileRoute = read("apps/mobile/app/community/quick-review.tsx");
    expect(webRoute).toContain("빠른 후기는 제공하지 않아요");
    expect(webRoute).not.toMatch(/fetch\(|supabase|rating|vendor_tags|PUBLIC_BETA_CAPABILITIES/);
    expect(mobileRoute).toContain('<Redirect href="/community/post/write" />');
    expect(mobileRoute).not.toMatch(/fetch\(|supabase|rating|vendor_tags|PUBLIC_BETA_CAPABILITIES/);
  });

  it("physically retires cohort screens and navigation", () => {
    const retiredPages = [
      "apps/web/src/app/(community)/community/cohort/[id]/page.tsx",
      "apps/web/src/app/(community)/community/cohort/page.tsx",
      "apps/mobile/app/community/cohort/[id].tsx",
      "apps/mobile/app/community/cohort-discovery.tsx",
    ];
    for (const path of retiredPages) {
      const page = read(path);
      expect(page, path).toContain('PublicBetaUnavailable feature="cohort"');
      expect(page, path).not.toMatch(/PUBLIC_BETA_CAPABILITIES|supabase|fetch\(|cohort_contracts|cohort_members/);
    }

    const navigation = [
      "apps/web/src/components/app/TopNav.tsx",
      "apps/web/src/components/community/CommunityLandingClient.tsx",
      "apps/web/src/components/community/UserMenu.tsx",
      "apps/web/src/app/(community)/layout.tsx",
      "apps/mobile/app/(tabs)/community.tsx",
      "apps/mobile/app/(tabs)/profile.tsx",
    ];
    for (const path of navigation) {
      expect(read(path), path).not.toMatch(/cohort-discovery|community\/cohort|PUBLIC_BETA_CAPABILITIES/);
    }
  });

  it("returns a fixed retired response across every cohort API", () => {
    const routes = [
      "apps/web/src/app/api/community/cohort/route.ts",
      "apps/web/src/app/api/community/cohort/auto-assign/route.ts",
      "apps/web/src/app/api/community/cohort/[id]/messages/route.ts",
      "apps/web/src/app/api/community/cohort/[id]/timeline/route.ts",
      "apps/web/src/app/api/community/cohort/[id]/contracts/route.ts",
      "apps/web/src/app/api/community/cohort/[id]/digest/route.ts",
      "apps/web/src/app/api/community/cohort/[id]/members/[userId]/report/route.ts",
      "apps/web/src/app/api/community/profile/wedding-date/route.ts",
      "apps/web/src/app/api/community/profiles/[userId]/route.ts",
    ];

    for (const path of routes) {
      const source = read(path);
      expect(source, path).toContain("cohortRoomsRetiredResponse");
      expect(source, path).not.toMatch(/createAdminClient|createClientFromRequest|req\.json|\.from\(|cohort_members|cohort_contracts/);
    }
  });

  it("has no dormant public capability registry", () => {
    const shared = read("packages/shared/src/constants/index.ts");
    expect(shared).not.toMatch(/PUBLIC_BETA_CAPABILITIES|vendorCatalog|cohortRooms|quickReview|pushNotifications/);
  });
});
