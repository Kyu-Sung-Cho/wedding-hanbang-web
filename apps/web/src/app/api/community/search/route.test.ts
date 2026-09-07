// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  getCommunityAuthorMap: vi.fn(async () => ({})),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "search-test"),
}));
vi.mock("@/lib/community/authorProfiles", () => ({
  getCommunityAuthorMap: mocks.getCommunityAuthorMap,
  fallbackCommunityAuthor: (id: string) => ({ user_id: id, nickname: "익명" }),
}));

import { GET } from "./route";

describe("GET /api/community/search response privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({});
  });

  it("never allows a viewer-specific search response to be shared or cached", async () => {
    const response = await GET(
      new NextRequest("https://hanbang.ai/api/community/search?q="),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("uses partial Korean matching before pagination and keeps visibility/category filters", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      textSearch: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: query.or.mock.calls.length ? [{ id: "post", author_id: "author", title: "스드메는 어디가 좋나요?" }] : [],
        count: query.or.mock.calls.length ? 3 : 0,
        error: null,
      }).then(resolve),
    };
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from: vi.fn(() => query),
    });
    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/community/search?q=스드메&category=free&page=2&limit=1",
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      posts: [{ title: "스드메는 어디가 좋나요?" }], total: 3, hasMore: true,
    });
    expect(query.or).toHaveBeenCalledWith("title.ilike.%스드메%,content.ilike.%스드메%");
    expect(query.textSearch).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("visibility", "public");
    expect(query.eq).toHaveBeenCalledWith("under_review", false);
    expect(query.eq).toHaveBeenCalledWith("ad_disclosure", "general");
    expect(query.eq).toHaveBeenCalledWith("category", "free");
    expect(query.range).toHaveBeenCalledWith(1, 1);

    query.or.mockClear();
    await GET(new NextRequest("https://hanbang.ai/api/community/search?q=스드메%20추천"));
    expect(query.or).toHaveBeenCalledWith(
      "and(or(title.ilike.%스드메%,content.ilike.%스드메%),or(title.ilike.%추천%,content.ilike.%추천%))",
    );
  });
});
