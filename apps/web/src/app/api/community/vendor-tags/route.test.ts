import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/http/publicServiceReadRateLimit", () => ({
  checkPublicServiceReadRateLimit: vi.fn().mockResolvedValue(null),
}));

import { COMMUNITY_VENDOR_TAG_PUBLIC_SELECT } from "@/lib/community/vendorTagPublicFields";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

describe("GET /api/community/vendor-tags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a public field allowlist and bounds malformed limits", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    mocks.createAdminClient.mockReturnValue({ from });

    const response = await GET(
      new Request("https://hanbang.ai/api/community/vendor-tags?limit=not-a-number") as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(select).toHaveBeenCalledWith(COMMUNITY_VENDOR_TAG_PUBLIC_SELECT);
    expect(limit).toHaveBeenCalledWith(20);
  });
});
