import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCourtPublicFeed: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  listCourtPublicFeed: mocks.listCourtPublicFeed,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "public-feed-key"),
}));

import { GET } from "../public/route";

describe("GET /api/couple-court/public", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    vi.stubEnv("COUPLE_COURT_PUBLIC_ENABLED", "true");
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("passes validated global filters, ordering and pagination to the repository", async () => {
    mocks.listCourtPublicFeed.mockResolvedValue({ posts: [{ id: "post-7" }], total: 13 });

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-court/public?category=budget&mode=couple&sort=popular&page=2&limit=6",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      posts: [{ id: "post-7" }],
      total: 13,
      page: 2,
      limit: 6,
      total_pages: 3,
      has_more: true,
    });
    expect(mocks.listCourtPublicFeed).toHaveBeenCalledWith({
      limit: 6,
      offset: 6,
      category: "budget",
      mode: "couple",
      sort: "popular",
    });
  });

  it("clamps an out-of-range page and reloads the last valid server page", async () => {
    mocks.listCourtPublicFeed
      .mockResolvedValueOnce({ posts: [], total: 8 })
      .mockResolvedValueOnce({ posts: [{ id: "post-8" }], total: 8 });

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-court/public?page=999&limit=6",
    ));

    await expect(response.json()).resolves.toMatchObject({
      posts: [{ id: "post-8" }],
      total: 8,
      page: 2,
      total_pages: 2,
      has_more: false,
    });
    expect(mocks.listCourtPublicFeed).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 5_988 }));
    expect(mocks.listCourtPublicFeed).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 6 }));
  });

  it("rejects unknown filters before querying the public view", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-court/public?category=not-a-category",
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "COURT_PUBLIC_FILTER_INVALID" });
    expect(mocks.listCourtPublicFeed).not.toHaveBeenCalled();
  });
});
