import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "@/lib/supabase/public";
import { GET } from "../route";

vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }));

describe("/api/community/popular-tags GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses an anonymous published-only query before returning shared-cache data", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      not: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.not.mockResolvedValue({
      data: [{ tags: ["  계약 ", "계약", "", "a\u0000b", 7] }],
      error: null,
    });
    vi.mocked(createPublicClient).mockReturnValue({
      from: vi.fn(() => query),
    } as unknown as ReturnType<typeof createPublicClient>);

    const response = await GET();

    expect(query.eq).toHaveBeenCalledWith("visibility", "public");
    expect(query.eq).toHaveBeenCalledWith("under_review", false);
    expect(response.headers.get("Cache-Control")).toContain("public");
    await expect(response.json()).resolves.toEqual({
      tags: [
        { tag: "계약", count: 2 },
        { tag: "ab", count: 1 },
      ],
    });
  });
});
