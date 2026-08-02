import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "community:search:test"),
}));

import { GET } from "./route";

describe("GET /api/community/search privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("marks the optionally personalized search result private and non-cacheable", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const query = {
      select: vi.fn(),
      textSearch: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range,
    };
    query.select.mockReturnValue(query);
    query.textSearch.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(() => query),
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/community/search?q=dress") as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  });

  it("caps deep search offsets and page size", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const query = {
      select: vi.fn(), textSearch: vi.fn(), eq: vi.fn(), order: vi.fn(), range,
    };
    query.select.mockReturnValue(query);
    query.textSearch.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(() => query),
    });

    const response = await GET(new Request(
      "https://hanbang.ai/api/community/search?q=dress&page=999999&limit=999999",
    ) as never);

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(9_950, 9_999);
  });
});
