import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createPublicClient: vi.fn(),
  rateLimitKey: vi.fn((scope: string) => `${scope}:test-ip`),
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET } from "./route";

describe("GET /api/community/popular-tags publication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("excludes under-review posts before creating a shared-cache tag aggregate", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      not: vi.fn(),
      order: vi.fn(),
      limit,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.order.mockReturnValue(query);
    mocks.createPublicClient.mockReturnValue({ from: vi.fn(() => query) });

    const request = new Request(
      "https://hanbang.ai/api/community/popular-tags",
    ) as never;
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("visibility", "public");
    expect(query.eq).toHaveBeenCalledWith("under_review", false);
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(5_000);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(mocks.rateLimitKey).toHaveBeenCalledWith("community:popular-tags", request);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:popular-tags:test-ip",
      { maxRequests: 60, windowMs: 60 * 1000 },
      { failClosed: true },
    );
  });

  it.each([429, 503])(
    "returns %i before the public query when the durable limiter denies",
    async (status) => {
      mocks.checkRateLimitPersistent.mockResolvedValueOnce(
        new Response("limited", { status }),
      );

      const response = await GET(
        new Request("https://hanbang.ai/api/community/popular-tags") as never,
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(mocks.createPublicClient).not.toHaveBeenCalled();
    },
  );

  it("does not inherit caller Authorization into the public query client", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      not: vi.fn(),
      order: vi.fn(),
      limit,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.order.mockReturnValue(query);
    mocks.createPublicClient.mockReturnValue({ from: vi.fn(() => query) });

    const response = await GET(new Request(
      "https://hanbang.ai/api/community/popular-tags",
      { headers: { authorization: "Bearer caller-token" } },
    ) as never);

    expect(response.status).toBe(200);
    expect(mocks.createPublicClient).toHaveBeenCalledOnce();
  });
});
