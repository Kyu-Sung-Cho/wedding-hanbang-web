import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "community:comment:vote:test"),
}));

const COMMENT_ID = "223e4567-e89b-42d3-a456-426614174000";

describe("POST /api/community/comments/:id/vote", () => {
  it("is physically retired before authentication or database access", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const request = new NextRequest(`http://localhost/api/community/comments/${COMMENT_ID}/vote`, {
      method: "POST",
      body: JSON.stringify({ voteType: 1 }),
    });
    expect(request.method).toBe("POST");

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ code: "community_comment_votes_retired" });
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });
});
