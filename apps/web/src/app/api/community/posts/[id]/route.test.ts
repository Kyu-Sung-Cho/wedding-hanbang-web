// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test-ip`,
}));

import { GET } from "./route";

const POST_ID = "10000000-0000-4000-8000-000000000001";

describe("GET /api/community/posts/:id cost boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an over-limit public detail read before auth or database access", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
    );

    const response = await GET(
      new Request(`https://hanbang.ai/api/community/posts/${POST_ID}`) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:post:detail:test-ip",
      { maxRequests: 180, windowMs: 60 * 1000 },
    );
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("rejects a malformed ID without consuming the shared limiter", async () => {
    const response = await GET(
      new Request("https://hanbang.ai/api/community/posts/not-a-uuid") as never,
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });
});
