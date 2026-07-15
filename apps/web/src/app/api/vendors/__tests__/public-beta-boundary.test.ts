import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, checkRateLimitPersistent } from "@/utils/rateLimit";
import { GET as listVendors } from "../route";
import { GET as getVendor } from "../[id]/route";
import { GET as getAvailability } from "../[id]/availability/route";
import { GET as getStaff } from "../[id]/staff/route";
import { GET as getPhotoLikes, POST as togglePhotoLike } from "../[id]/photos/route";
import { GET as getFavorites, POST as toggleFavorite } from "../../favorites/route";
import { GET as listCommunityVendorTags } from "../../community/vendor-tags/route";
import { GET as getCommunityVendorTag } from "../../community/vendor-tags/[name]/route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(),
}));

describe("retired vendor catalog API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 410 from every catalog read before rate limits, auth, or DB", async () => {
    const responses = await Promise.all([
      listVendors(),
      getVendor(),
      getAvailability(),
      getStaff(),
      getPhotoLikes(),
      getFavorites(),
      listCommunityVendorTags(),
      getCommunityVendorTag(),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        code: "vendor_catalog_retired",
      });
    }
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 410 from catalog mutations without accepting a request body", async () => {
    const responses = await Promise.all([
      toggleFavorite(),
      togglePhotoLike(),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        code: "vendor_catalog_retired",
      });
    }
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("contains no latent auth, body parsing, catalog queries, or availability logic", () => {
    const routes = [
      "src/app/api/vendors/route.ts",
      "src/app/api/vendors/[id]/route.ts",
      "src/app/api/vendors/[id]/availability/route.ts",
      "src/app/api/vendors/[id]/staff/route.ts",
      "src/app/api/vendors/[id]/photos/route.ts",
      "src/app/api/favorites/route.ts",
      "src/app/api/community/vendor-tags/route.ts",
      "src/app/api/community/vendor-tags/[name]/route.ts",
    ];

    for (const path of routes) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).toContain("vendorCatalogRetiredResponse");
      expect(source, path).not.toMatch(/createAdminClient|createClientFromRequest|req\.json|request\.json|\.from\(|vendor_bookings|vendor_timeslots|checkRateLimit/);
    }
  });
});
