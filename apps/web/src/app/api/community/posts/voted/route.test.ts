import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  rateLimit: vi.fn(),
  getCommunityPublicIdForUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.rateLimit,
  rateLimitKey: vi.fn((prefix: string) => `${prefix}:test`),
}));

vi.mock("@/lib/community/publicIdentity", () => ({
  getCommunityPublicIdForUser: mocks.getCommunityPublicIdForUser,
}));

import { GET } from "./route";

describe("GET /api/community/posts/voted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommunityPublicIdForUser.mockResolvedValue(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("applies the shared authenticated limiter before reading votes", async () => {
    const from = vi.fn();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from,
    });
    mocks.rateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    const response = await GET(new Request(
      "https://hanbang.ai/api/community/posts/voted?page=1000&limit=100",
    ) as never);

    expect(response.status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it("caps deep authenticated vote-history offsets", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null });
    const query = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(), range,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn(() => query),
    });
    mocks.rateLimit.mockResolvedValue(null);

    const response = await GET(new Request(
      "https://hanbang.ai/api/community/posts/voted?page=999999&limit=999999",
    ) as never);

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(9_950, 9_999);
  });
});
