import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community:post:report:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const POST_ID = "223e4567-e89b-42d3-a456-426614174000";

function context(id = POST_ID) {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown, contentLength?: number) {
  return new NextRequest(`http://localhost/api/community/posts/${POST_ID}/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
    },
    body: JSON.stringify(body),
  });
}

function postQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function mockAuth(options: {
  user?: { id: string } | null;
  authError?: unknown;
  postResult?: unknown;
} = {}) {
  const query = postQuery(
    options.postResult ?? { data: { id: POST_ID }, error: null },
  );
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: USER_ID } : options.user },
        error: options.authError ?? null,
      }),
    },
    from: vi.fn(() => query),
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  return query;
}

describe("POST /api/community/posts/:id/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it("fails closed when authentication cannot be verified", async () => {
    mockAuth({ user: null, authError: { message: "auth unavailable" } });

    const response = await POST(request({ reason: "spam" }), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ reason: "spam", post_id: POST_ID }, undefined, 400],
    [{ reason: "not-valid" }, undefined, 400],
    [{ reason: "spam" }, 8 * 1024 + 1, 413],
  ])("rejects unknown, invalid, or oversized report data", async (body, size, status) => {
    mockAuth();

    const response = await POST(request(body, size), context());

    expect(response.status).toBe(status);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not disguise a post visibility lookup failure as a missing post", async () => {
    mockAuth({ postResult: { data: null, error: { message: "read failed" } } });

    const response = await POST(request({ reason: "spam" }), context());

    expect(response.status).toBe(503);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("stores the exact visible post target and a narrow payload", async () => {
    const query = mockAuth();
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(
      request({ reason: "abuse", details: "  확인 부탁드립니다.  " }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(query.select).toHaveBeenCalledWith("id");
    expect(insert).toHaveBeenCalledWith({
      reporter_id: USER_ID,
      post_id: POST_ID,
      reason: "abuse",
      description: "확인 부탁드립니다.",
      status: "pending",
    });
    expect(insert.mock.calls[0][0]).not.toHaveProperty("comment_id");
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:post:report:test",
      { maxRequests: 5, windowMs: 60 * 60 * 1_000 },
      USER_ID,
    );
  });

  it("returns a truthful conflict for a duplicate report", async () => {
    mockAuth();
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505" } });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(request({ reason: "spam" }), context());

    expect(response.status).toBe(409);
  });
});
