import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

import { listCourtPublicFeed } from "@/lib/coupleCourt/repository";

function publicFeedQuery(result: { data: unknown[]; count: number | null; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.range = vi.fn().mockResolvedValue(result);
  return query;
}

describe("listCourtPublicFeed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("applies filters and global popularity ordering before the requested range", async () => {
    const query = publicFeedQuery({
      data: [{ id: "post-7" }],
      count: 19,
      error: null,
    });
    mocks.from.mockReturnValue(query);

    await expect(listCourtPublicFeed({
      limit: 6,
      offset: 6,
      category: "budget",
      mode: "couple",
      sort: "popular",
    })).resolves.toEqual({ posts: [{ id: "post-7" }], total: 19 });

    expect(mocks.from).toHaveBeenCalledWith("court_public_feed");
    expect(query.select).toHaveBeenCalledWith(expect.any(String), { count: "exact" });
    expect(query.eq).toHaveBeenNthCalledWith(1, "category", "budget");
    expect(query.eq).toHaveBeenNthCalledWith(2, "mode", "couple");
    expect(query.order.mock.calls).toEqual([
      ["vote_count", { ascending: false }],
      ["published_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(query.range).toHaveBeenCalledWith(6, 11);
  });

  it("fails closed when the exact total needed for safe pagination is absent", async () => {
    const query = publicFeedQuery({ data: [], count: null, error: null });
    mocks.from.mockReturnValue(query);

    await expect(listCourtPublicFeed({
      limit: 6,
      offset: 0,
      sort: "latest",
    })).rejects.toThrow("사건 정보를 처리하지 못했어요.");
  });
});
