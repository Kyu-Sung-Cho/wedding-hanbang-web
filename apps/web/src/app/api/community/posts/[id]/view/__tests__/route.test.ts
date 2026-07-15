import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community:view:test"),
}));

const POST_ID = "223e4567-e89b-42d3-a456-426614174000";

function request() {
  return new NextRequest(`http://localhost/api/community/posts/${POST_ID}/view`, {
    method: "POST",
  });
}

function context() {
  return { params: Promise.resolve({ id: POST_ID }) };
}

describe("POST /api/community/posts/:id/view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it("fails closed when authentication state cannot be verified", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "auth unavailable" },
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses a persistent IP bucket without a lifecycle subject for an anonymous view", async () => {
    const visiblePostQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: POST_ID,
          author_id: "323e4567-e89b-42d3-a456-426614174000",
          visibility: "public",
          under_review: false,
        },
        error: null,
      }),
    };
    visiblePostQuery.select.mockReturnValue(visiblePostQuery);
    visiblePostQuery.eq.mockReturnValue(visiblePostQuery);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn(() => visiblePostQuery),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createClient>);

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:view:test",
      { maxRequests: 10, windowMs: 60 * 1000 },
      undefined,
    );
    expect(rpc).toHaveBeenCalledWith("community_increment_view", { p_post_id: POST_ID });
  });
});
