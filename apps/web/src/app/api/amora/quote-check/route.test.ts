import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: async () => null,
  rateLimitKey: () => "quote-check:test",
}));

import { POST } from "./route";

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest("https://hanbang.ai/api/amora/quote-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 250,
      vendorName: "테스트 스튜디오",
      memo: "추가금 확인",
      includedItemIds: [],
      bookingChannel: "unknown",
      quoteStage: "quote_only",
      ...extra,
    }),
  });
}

describe("POST /api/amora/quote-check consent boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not open an admin storage path for an authenticated user without opt-in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedId).toBeUndefined();
    expect(body.storageStatus).toBe("not_stored");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("ignores retired storage flags and does not store a guest submission", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request({
      saveToAccount: true,
      contributeVendorSignal: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedId).toBeUndefined();
    expect(body.storageStatus).toBe("not_stored");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps included and not-needed choices separate", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request({
      includedItemIds: ["studio_original_data"],
      notNeededItemIds: ["studio_video"],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis.includedItems.map((item: { id: string }) => item.id))
      .toContain("studio_original_data");
    expect(body.analysis.notNeededItems.map((item: { id: string }) => item.id))
      .toContain("studio_video");
    expect(body.analysis.missingItems.map((item: { id: string }) => item.id))
      .not.toContain("studio_video");
  });
});
