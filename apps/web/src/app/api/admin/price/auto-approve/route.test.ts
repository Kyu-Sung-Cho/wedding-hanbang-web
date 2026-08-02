import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.rateLimit,
  rateLimitKey: vi.fn((prefix: string) => `${prefix}:test`),
}));

import { GET, POST } from "./route";

describe("admin price auto approval limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.rateLimit.mockResolvedValue(new Response(null, { status: 429 }));
  });

  it("limits the high-cost preview before loading eligible rows", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/auto-approve",
    ));

    expect(response.status).toBe(429);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("limits the batch mutation before parsing or database RPCs", async () => {
    const request = new Request("https://hanbang.ai/api/admin/price/auto-approve", {
      method: "POST",
      headers: {
        origin: "https://hanbang.ai",
        "sec-fetch-site": "same-origin",
      },
      body: "not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("never returns a database failure message in the batch result", async () => {
    const privateMarker = "bride@example.com token=private-provider-diagnostic";
    mocks.rateLimit.mockResolvedValue(null);

    const eligibleRow = {
      id: "10000000-0000-4000-8000-000000000001",
      vendor_id: "20000000-0000-4000-8000-000000000002",
      category: "studio",
      item_name: "기본 촬영",
      base_spec: null,
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      source_quote: "공개 검수 근거",
      confidence: 0.95,
      review_version: 1,
      official_price_options: [],
    };
    const query = (result: unknown) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        contains: vi.fn(() => builder),
        not: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(async () => result),
      };
      return builder;
    };
    const eligibleQuery = query({ data: [eligibleRow], error: null });
    const dedupeQuery = query({ data: [], error: null });
    const client = {
      from: vi.fn((table: string) => (
        table === "official_prices" ? eligibleQuery : dedupeQuery
      )),
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "XX000", message: privateMarker },
      })),
    };
    mocks.getServiceClient.mockReturnValue(client);

    const response = await POST(new Request(
      "https://hanbang.ai/api/admin/price/auto-approve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://hanbang.ai",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          confirmation: "approve_agent_auto_validated_pending",
          expected_count: 1,
        }),
      },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.failures).toEqual([{
      id: eligibleRow.id,
      reason: "승인 처리에 실패했습니다.",
    }]);
    expect(JSON.stringify(body)).not.toContain(privateMarker);
    expect(JSON.stringify(body)).not.toContain("bride@example.com");
  });
});
