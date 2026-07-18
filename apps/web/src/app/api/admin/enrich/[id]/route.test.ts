import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET, PATCH } from "./route";

describe("PATCH /api/admin/enrich/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically stores public attributes, private notes, tags, and completion", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000001";
    const actorId = "00000000-0000-4000-8000-000000000002";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const single = vi.fn().mockResolvedValue({
      data: { id: vendorId, category: "studio" },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const statusIn = vi.fn().mockReturnValue({ single });
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ in: statusIn })) })),
      })),
      rpc,
    });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        official_url: "https://sample.example.com",
        instagram_url: null,
        naver_place_url: null,
        attributes: {
          price_band: "mid",
          shoot_locations: ["indoor"],
          notes_internal: "샘플 내부 확인 메모",
        },
        tag_ids: ["00000000-0000-4000-8000-000000000003"],
      }),
    }), { params: Promise.resolve({ id: vendorId }) });

    expect(response.status).toBe(200);
    expect(statusIn).toHaveBeenCalledWith("status", ["pending", "approved"]);
    expect(rpc).toHaveBeenCalledWith("save_vendor_enrichment", {
      p_vendor_id: vendorId,
      p_actor_id: actorId,
      p_official_url: "https://sample.example.com",
      p_instagram_url: null,
      p_naver_place_url: null,
      p_attributes: { shoot_locations: ["indoor"] },
      p_price_band: "mid",
      p_notes_internal: "샘플 내부 확인 메모",
      p_tag_ids: ["00000000-0000-4000-8000-000000000003"],
      p_complete: true,
    });
  });

  it("returns 404 and never writes a rejected vendor", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000021";
    const actorId = "00000000-0000-4000-8000-000000000022";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const rpc = vi.fn();
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ in: vi.fn().mockReturnValue({ single }) })),
        })),
      })),
      rpc,
    });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: vendorId }) });

    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/enrich/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an evidence-linked fitting-fee proposal without persisting it", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000011";
    const actorId = "00000000-0000-4000-8000-000000000012";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });

    const vendorSingle = vi.fn().mockResolvedValue({
      data: {
        id: vendorId,
        name: "샘플드레스",
        slug: "sample-dress",
        category: "dress",
        region_code: "seoul_gangnam3",
        official_url: null,
        instagram_url: null,
        naver_place_url: null,
        attributes: {},
        enrichment_status: "in_progress",
        enriched_at: null,
        private: [{ price_band: null, notes_internal: null, enriched_by: actorId }],
      },
      error: null,
    });
    const tagAssignments = Promise.resolve({ data: [], error: null });
    const tagsQuery = {
      data: [],
      error: null,
      order: vi.fn(),
    };
    tagsQuery.order.mockReturnValue(tagsQuery);
    const pricesOrder = vi.fn().mockResolvedValue({
      data: [{
        id: "00000000-0000-4000-8000-000000000013",
        category: "dress",
        item_name: "샘플 드레스",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_000_000,
        vat_note: null,
        price_note: null,
        source_file: "샘플.xlsx",
        source_object_keys: [`${"a".repeat(64)}.xlsx`],
        source_quote: "샘플 드레스 100만원",
        confidence: 1,
        review_status: "approved",
        snapshot: { period_label: "2026Q3", source: "kca_tprice", published_at: null },
        agency: null,
        options: [{
          id: "00000000-0000-4000-8000-000000000014",
          name: "기본 피팅비",
          price_min_krw: 50_000,
          price_max_krw: 50_000,
          unit: "1회",
          condition: null,
          raw_text: "샘플 기본 피팅비 5만원",
          source_quote: "샘플 기본 피팅비 5만원",
          confidence: 1,
        }],
      }],
      error: null,
    });

    const activeVendorIn = vi.fn().mockReturnValue({ single: vendorSingle });
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "vendors") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ in: activeVendorIn })) })) };
        }
        if (table === "vendor_tags") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => tagAssignments) })) };
        }
        if (table === "tags") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => tagsQuery) })) };
        }
        if (table === "official_prices") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ order: pricesOrder })) })) };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    });

    const response = await GET(
      new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`),
      { params: Promise.resolve({ id: vendorId }) },
    );
    expect(response.status).toBe(200);
    expect(activeVendorIn).toHaveBeenCalledWith("status", ["pending", "approved"]);
    const body = await response.json();
    expect(body.attribute_suggestions.fitting_fee_krw).toEqual({
      value_krw: 50_000,
      source_quote: "샘플 기본 피팅비 5만원",
      price_id: "00000000-0000-4000-8000-000000000013",
      option_id: "00000000-0000-4000-8000-000000000014",
    });
    expect(body.vendor.attributes).not.toHaveProperty("fitting_fee_krw");
  });

  it("does not expose a rejected or merged vendor detail", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000031";
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: "00000000-0000-4000-8000-000000000032",
    });
    const vendorSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116" },
    });
    const empty = Promise.resolve({ data: [], error: null });
    const orderedEmpty = { data: [], error: null, order: vi.fn() };
    orderedEmpty.order.mockReturnValue(orderedEmpty);
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "vendors") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockReturnValue({ single: vendorSingle }),
              })),
            })),
          };
        }
        if (table === "vendor_tags") return { select: vi.fn(() => ({ eq: vi.fn(() => empty) })) };
        if (table === "tags") return { select: vi.fn(() => ({ eq: vi.fn(() => orderedEmpty) })) };
        if (table === "official_prices") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) })) })) };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    });

    const response = await GET(
      new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`),
      { params: Promise.resolve({ id: vendorId }) },
    );

    expect(response.status).toBe(404);
  });
});
