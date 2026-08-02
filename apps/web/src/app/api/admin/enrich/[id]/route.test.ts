import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkAdminReadRateLimit: vi.fn(),
  checkAdminMutationRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/admin/adminReadBoundary", () => ({
  checkAdminReadRateLimit: mocks.checkAdminReadRateLimit,
  checkAdminMutationRateLimit: mocks.checkAdminMutationRateLimit,
}));

import {
  ADMIN_STEP_UP_COOKIE,
  createAdminStepUpToken,
} from "@/lib/auth/adminStepUp";
import { GET, PATCH } from "./route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const ADMIN_PASSWORD = "admin-bootstrap-secret-longer-than-32-characters";

function resetAdminTest() {
  vi.resetAllMocks();
  vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
  mocks.checkAdminReadRateLimit.mockResolvedValue(null);
  mocks.checkAdminMutationRateLimit.mockResolvedValue(null);
}

function primeAdminBoundary(businessClient: unknown) {
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: ADMIN_ID } },
      }),
    },
  });
  mocks.createAdminClient
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { is_admin: true } }),
          })),
        })),
      })),
    })
    .mockReturnValueOnce(businessClient);
}

function stepUpHeaders(): Record<string, string> {
  const token = createAdminStepUpToken(ADMIN_ID);
  if (!token) throw new Error("admin step-up test token was not created");
  return { cookie: `${ADMIN_STEP_UP_COOKIE}=${token}` };
}

function mutationHeaders(includeStepUp = true): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: "https://hanbang.ai",
    "sec-fetch-site": "same-origin",
    ...(includeStepUp ? stepUpHeaders() : {}),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("PATCH /api/admin/enrich/:id", () => {
  beforeEach(resetAdminTest);

  it("rejects an authenticated administrator without a signed step-up", async () => {
    const rpc = vi.fn();
    primeAdminBoundary({ rpc });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/enrich/${ADMIN_ID}`,
      {
        method: "PATCH",
        headers: mutationHeaders(false),
        body: JSON.stringify({}),
      },
    ), { params: Promise.resolve({ id: ADMIN_ID }) });

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.checkAdminMutationRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("atomically stores public attributes, private notes, tags, and completion", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000001";
    const actorId = ADMIN_ID;
    const single = vi.fn().mockResolvedValue({
      data: { id: vendorId, category: "studio" },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const statusIn = vi.fn().mockReturnValue({ single });
    primeAdminBoundary({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ in: statusIn })) })),
      })),
      rpc,
    });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`, {
      method: "PATCH",
      headers: mutationHeaders(),
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
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const rpc = vi.fn();
    primeAdminBoundary({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ in: vi.fn().mockReturnValue({ single }) })),
        })),
      })),
      rpc,
    });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`, {
      method: "PATCH",
      headers: mutationHeaders(),
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: vendorId }) });

    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/enrich/:id", () => {
  beforeEach(resetAdminTest);

  it("returns an evidence-linked fitting-fee proposal without persisting it", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000011";
    const actorId = ADMIN_ID;

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
    primeAdminBoundary({
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
      new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`, {
        headers: stepUpHeaders(),
      }),
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
    const vendorSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116" },
    });
    const empty = Promise.resolve({ data: [], error: null });
    const orderedEmpty = { data: [], error: null, order: vi.fn() };
    orderedEmpty.order.mockReturnValue(orderedEmpty);
    primeAdminBoundary({
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
      new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}`, {
        headers: stepUpHeaders(),
      }),
      { params: Promise.resolve({ id: vendorId }) },
    );

    expect(response.status).toBe(404);
  });
});
