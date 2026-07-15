import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community:vote:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const POST_ID = "223e4567-e89b-42d3-a456-426614174000";

function request() {
  return new NextRequest(`http://localhost/api/community/posts/${POST_ID}/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voteType: 1 }),
  });
}

function query(result: unknown) {
  const value = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
  };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  return value;
}

function context() {
  return { params: Promise.resolve({ id: POST_ID }) };
}

describe("POST /api/community/posts/:id/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it("does not disguise a visibility lookup failure as a missing post", async () => {
    const visiblePost = query({ data: null, error: { message: "read failed" } });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
      from: vi.fn(() => visiblePost),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:vote:test",
      { maxRequests: 60, windowMs: 60 * 1000 },
      USER_ID,
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not return false zero counts when verification fails after a vote", async () => {
    const visiblePost = query({ data: { id: POST_ID }, error: null });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
      from: vi.fn(() => visiblePost),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
    const counts = query({ data: null, error: { message: "count read failed" } });
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn(() => counts),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.retrySafe).toBe(true);
    expect(body.upvote_count).toBeUndefined();
  });
});
