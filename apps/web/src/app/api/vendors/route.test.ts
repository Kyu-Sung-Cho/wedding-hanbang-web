import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  rateLimitKey: vi.fn((scope: string) => `${scope}:test-ip`),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET } from "./route";

function emptyVendorQuery() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

describe("GET /api/vendors public catalog abuse boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("returns a normal public response when the durable shared bucket allows it", async () => {
    const query = emptyVendorQuery();
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) });
    const request = new Request("https://hanbang.ai/api/vendors");

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      vendors: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    expect(mocks.rateLimitKey).toHaveBeenCalledWith("public-vendor-catalog", request);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "public-vendor-catalog:test-ip",
      { maxRequests: 120, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
  });

  it.each([
    [429, "rate limit exhausted"],
    [503, "durable limiter unavailable"],
  ])("returns %i before service-role access when %s", async (status) => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response("limited", { status }),
    );

    const response = await GET(new Request("https://hanbang.ai/api/vendors"));

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a wholly invalid ID filter before limiter or service-role work", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/vendors?ids=not-a-uuid,still-not-a-uuid",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ vendors: [], total: 0 });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("caps deep public offsets before issuing a service-role query", async () => {
    const query = emptyVendorQuery();
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) });

    const response = await GET(new Request(
      "https://hanbang.ai/api/vendors?page=999999&limit=999999",
    ));

    expect(response.status).toBe(200);
    expect(query.range).toHaveBeenCalledWith(19_900, 19_999);
  });
});
