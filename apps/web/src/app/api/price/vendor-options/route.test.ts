import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createPublicClient: vi.fn(),
  rateLimitKey: vi.fn((scope: string) => `${scope}:test-ip`),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

import { GET } from "./route";

const PRICE_ID = "11111111-1111-4111-8111-111111111111";

function emptyOptionsQuery() {
  const query = {
    select: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  query.select.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

describe("GET /api/price/vendor-options durable abuse boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("shares the durable public catalog bucket on cache misses", async () => {
    const query = emptyOptionsQuery();
    mocks.createPublicClient.mockReturnValue({ from: vi.fn(() => query) });
    const request = new Request(
      `https://hanbang.ai/api/price/vendor-options?ids=${PRICE_ID}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(mocks.rateLimitKey).toHaveBeenCalledWith("public-vendor-catalog", request);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "public-vendor-catalog:test-ip",
      { maxRequests: 120, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createPublicClient).toHaveBeenCalledOnce();
  });

  it.each([429, 503])(
    "returns %i without a public database query when the durable bucket denies",
    async (status) => {
      mocks.checkRateLimitPersistent.mockResolvedValueOnce(
        new Response("limited", { status }),
      );

      const response = await GET(new Request(
        `https://hanbang.ai/api/price/vendor-options?ids=${PRICE_ID}`,
      ));

      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(mocks.createPublicClient).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid IDs before limiter or database work", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/price/vendor-options?ids=not-a-uuid",
    ));

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });
});
