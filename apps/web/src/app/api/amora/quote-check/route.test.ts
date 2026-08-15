import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createAdminClient: vi.fn(),
  loadPublicPriceCatalog: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({ kind: "public-client" }),
}));

vi.mock("@/lib/price/publicListData", () => ({
  loadPublicPriceCatalog: mocks.loadPublicPriceCatalog,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: async () => null,
  rateLimitKey: () => "quote-check:test",
}));

import { POST } from "./route";

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest("https://hanbang.ai/api/amora/quote-check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://hanbang.ai",
    },
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
    mocks.loadPublicPriceCatalog.mockRejectedValue(new Error("catalog unavailable"));
  });

  it("uses the reviewed public catalog for a comparable checklist without storing the quote", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.loadPublicPriceCatalog.mockResolvedValue({
      periodLabel: "2025년 11월",
      categories: {
        studio: [100, 200, 300].map((minimumManwon, index) => ({
          id: `vendor-${index}`,
          slug: `vendor-${index}`,
          name: `공시 업체 ${index}`,
          aliases: [],
          category: "studio",
          regionCode: "seoul_etc",
          regionCodes: ["seoul_etc"],
          offers: [{
            id: `offer-${index}`,
            agencyId: `agency-${index}`,
            agencyName: `공시 대행사 ${index}`,
            regionCode: "seoul_etc",
            minimumKrw: minimumManwon * 10_000,
            maximumKrw: minimumManwon * 10_000,
            priceNote: null,
            baseSpec: "기본 구성",
            options: [],
          }],
        })),
        dress: [],
        makeup: [],
        hall: [],
      },
      counts: { studio: 3, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    });

    const response = await POST(request({ region: "seoul" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.storageStatus).toBe("not_stored");
    expect(body.analysis.marketMedianManwon).toBe(200);
    expect(body.analysis.marketEvidence).toMatchObject({
      status: "available",
      observationCount: 3,
      vendorCount: 3,
      source: "한국소비자원 참가격",
    });
    expect(mocks.loadPublicPriceCatalog).toHaveBeenCalledWith(
      { kind: "public-client" },
      { optionCategories: [], priceCategories: ["studio"] },
    );
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

  it("rejects a streamed oversized body without Content-Length before auth", async () => {
    const oversized = new NextRequest("https://hanbang.ai/api/amora/quote-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://hanbang.ai",
      },
      body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
    });
    expect(oversized.headers.get("content-length")).toBeNull();

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("fails closed on malformed JSON before auth", async () => {
    const response = await POST(new NextRequest("https://hanbang.ai/api/amora/quote-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://hanbang.ai",
      },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not coerce a string quote price into a number", async () => {
    const response = await POST(request({ quotePriceManwon: "250" }));

    expect(response.status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects an untrusted browser mutation before reading auth state", async () => {
    const response = await POST(new NextRequest("https://hanbang.ai/api/amora/quote-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "studio", region: "seoul" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not expose a raw auth provider failure", async () => {
    const providerMessage = "internal auth service tenant detail";
    mocks.getUser.mockRejectedValue(new Error(providerMessage));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain(providerMessage);
    expect(body).toEqual({ error: "체크리스트 결과를 가져오지 못했습니다." });
  });
});
