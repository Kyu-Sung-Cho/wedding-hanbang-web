import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("vendor and booking public beta boundary", () => {
  it("physically retires every legacy web and mobile vendor or booking screen", () => {
    const vendorRoutes = [
      "apps/web/src/app/(app)/vendors/page.tsx",
      "apps/web/src/app/(app)/vendors/[id]/page.tsx",
      "apps/web/src/app/(app)/vendors/favorites/page.tsx",
      "apps/web/src/app/(app)/favorites/page.tsx",
      "apps/web/src/app/(community)/community/vendor/[name]/page.tsx",
      "apps/mobile/app/vendors/index.tsx",
      "apps/mobile/app/vendors/[id].tsx",
    ];

    for (const route of vendorRoutes) {
      const source = read(route);
      expect(source, route).toContain("PublicBetaUnavailable");
      expect(source, route).toContain('feature="vendor"');
      expect(source, route).not.toMatch(/Enabled(?:Page|Screen)|PUBLIC_BETA_CAPABILITIES|supabase|fetch\(|apiFetch|vendor_bookings/);
    }

    for (const route of [
      "apps/web/src/app/(app)/bookings/page.tsx",
      "apps/mobile/app/bookings/index.tsx",
    ]) {
      const source = read(route);
      expect(source, route).toContain("PublicBetaUnavailable");
      expect(source, route).toContain('feature="booking"');
      expect(source, route).not.toMatch(/Enabled(?:Page|Screen)|PUBLIC_BETA_CAPABILITIES|vendor_bookings|supabase/);
    }
  });

  it("removes legacy navigation, community linkage, and booking data from AI", () => {
    const sidebar = read("apps/web/src/components/app/Sidebar.tsx");
    const topNav = read("apps/web/src/components/app/TopNav.tsx");
    const userMenu = read("apps/web/src/components/community/UserMenu.tsx");
    const communityPost = read("apps/web/src/app/(community)/community/post/[id]/page.tsx");
    const communityWriter = read("apps/web/src/app/(community)/community/post/write/page.tsx");
    const communityPostApi = read("apps/web/src/app/api/community/posts/[id]/route.ts");
    const communityPostsApi = read("apps/web/src/app/api/community/posts/route.ts");
    const messagesApi = read("apps/web/src/app/api/messages/route.ts");
    const chatApi = read("apps/web/src/app/api/chat/route.ts");
    const landingFooter = read("apps/web/src/components/landing/Footer.tsx");
    const budget = read("apps/web/src/components/app/budget/BudgetContent.tsx");
    const dashboard = read("apps/mobile/app/(tabs)/dashboard.tsx");
    const profile = read("apps/mobile/app/(tabs)/profile.tsx");

    for (const [name, source] of [
      ["sidebar", sidebar],
      ["topNav", topNav],
      ["userMenu", userMenu],
      ["communityPost", communityPost],
      ["communityWriter", communityWriter],
      ["landingFooter", landingFooter],
      ["mobileDashboard", dashboard],
      ["mobileProfile", profile],
    ] as const) {
      expect(source, name).not.toMatch(/PUBLIC_BETA_CAPABILITIES|\/vendors|\/bookings|vendor_details|VendorTagPicker/);
    }
    expect(communityPostApi).not.toMatch(/PUBLIC_BETA_CAPABILITIES|vendor_details/);
    expect(communityPostsApi).not.toContain("PUBLIC_BETA_CAPABILITIES");
    expect(communityPostsApi).toMatch(/retiredFields[\s\S]*?"vendor_tags"/);
    expect(messagesApi).toContain("status: 410");
    expect(messagesApi).not.toMatch(/createClient|createAdminClient|supabase|auth\.getUser|\.from\(/);
    expect(chatApi).not.toContain('from("vendor_bookings")');
    expect(chatApi).not.toContain("bookingRows");
    expect(chatApi).not.toContain("PUBLIC_BETA_CAPABILITIES.bookingManagement");
    expect(chatApi).not.toMatch(/search_vendors|create_booking|get_my_bookings|cancel_booking/);
    expect(budget).not.toContain("vendor_bookings");
    expect(dashboard).not.toMatch(/vendor_bookings|BOOKING_OUTCOMES_ENABLED|bookingOutcomeTasks/);
  });

  it("physically removes orphaned vendor, booking-contact, and quote-sharing capability seams", () => {
    for (const retiredPath of [
      "apps/web/src/data/vendorFields.ts",
      "apps/web/src/constants/vendorAsymmetry.ts",
      "apps/web/src/lib/bookings/contact.ts",
      "apps/web/src/lib/bookings/__tests__/contact.test.ts",
      "apps/web/src/components/quote/ShareButtons.tsx",
      "apps/web/src/components/app/AmoraDirector.tsx",
      "apps/web/src/lib/__tests__/resendVendorEmail.test.ts",
    ]) {
      expect(existsSync(resolve(repoRoot, retiredPath)), retiredPath).toBe(false);
    }

    const adminVendorMutation = read("apps/web/src/app/api/admin/vendors/[id]/route.ts");
    const adminBookings = read("apps/web/src/app/api/admin/bookings/route.ts");
    const adminPage = read("apps/web/src/app/(admin)/admin/page.tsx");
    const resend = read("apps/web/src/lib/resend.ts");

    expect(adminVendorMutation).toContain("VENDOR_ADMIN_MUTATION_RETIRED");
    expect(adminVendorMutation).toContain("status: 410");
    expect(adminVendorMutation).not.toMatch(
      /verifyAdmin|getServiceClient|sendVendor|request\.json|\.from\(|\.update\(/,
    );
    expect(adminBookings).toContain("ADMIN_BOOKING_HISTORY_RETIRED");
    expect(adminBookings).toContain("status: 410");
    expect(adminBookings).not.toMatch(
      /verifyAdmin|getServiceClient|vendor_bookings|contact_phone|bride_name|groom_name|memo|\.from\(/,
    );
    expect(adminPage).toContain("과거 업체 기록");
    expect(adminPage).not.toContain('{ key: "bookings"');
    expect(adminPage).toMatch(/uppercase">상세<\/th>/);
    expect(adminPage).not.toMatch(/handleApprove|handleReject|handleRevoke|api\/admin\/vendors\/\$\{id\}/);
    expect(resend).not.toMatch(/(?:send|build)Vendor(?:Approval|Rejection)Email/);
  });
});
