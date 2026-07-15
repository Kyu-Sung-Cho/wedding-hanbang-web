import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/community/actorIdentity", () => ({
  getCommunityActorIdForUser: vi.fn(),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn((key: string) => `${key}:test`),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const AUTHOR_ID = "223e4567-e89b-42d3-a456-426614174000";
const VIEWER_ACTOR_ID = "423e4567-e89b-42d3-a456-426614174000";
const COMMENT_ID = "323e4567-e89b-42d3-a456-426614174000";

function context(id = COMMENT_ID) {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown, contentLength?: number) {
  return new NextRequest(`http://localhost/api/community/comments/${COMMENT_ID}/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
    },
    body: JSON.stringify(body),
  });
}

function commentQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function mockAuth(
  user: { id: string } | null,
  options: { authError?: unknown; commentResult?: unknown } = {},
) {
  const query = commentQuery(
    options.commentResult ?? {
      data: { id: COMMENT_ID, author_id: AUTHOR_ID, is_deleted: false },
      error: null,
    },
  );
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: options.authError ?? null,
      }),
    },
    from: vi.fn(() => query),
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  return query;
}

describe("POST /api/community/comments/:id/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(getCommunityActorIdForUser).mockResolvedValue(VIEWER_ACTOR_ID);
  });

  it("fails closed when authentication cannot be verified", async () => {
    mockAuth(null, { authError: { message: "auth unavailable" } });

    const response = await POST(request({ reason: "spam" }), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ reason: "spam", post_id: COMMENT_ID }, undefined, 400],
    [{ reason: "not-allowed" }, undefined, 400],
    [{ reason: "spam" }, 8 * 1024 + 1, 413],
  ])("rejects unknown, invalid, or oversized report data", async (body, size, status) => {
    mockAuth({ id: USER_ID });

    const response = await POST(request(body, size), context());

    expect(response.status).toBe(status);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("stores the exact comment target and never substitutes a post target", async () => {
    mockAuth({ id: USER_ID });
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
    expect(insert).toHaveBeenCalledWith({
      reporter_id: USER_ID,
      comment_id: COMMENT_ID,
      reason: "abuse",
      description: "확인 부탁드립니다.",
      status: "pending",
    });
    expect(insert.mock.calls[0][0]).not.toHaveProperty("post_id");
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:comment:report:test",
      { maxRequests: 5, windowMs: 60 * 60 * 1_000 },
      USER_ID,
    );
  });

  it("does not let an author report their own comment", async () => {
    mockAuth({ id: USER_ID }, {
      commentResult: {
        data: { id: COMMENT_ID, author_id: VIEWER_ACTOR_ID, is_deleted: false },
        error: null,
      },
    });

    const response = await POST(request({ reason: "spam" }), context());

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not report a missing or deleted comment", async () => {
    mockAuth({ id: USER_ID }, {
      commentResult: {
        data: { id: COMMENT_ID, author_id: AUTHOR_ID, is_deleted: true },
        error: null,
      },
    });

    const response = await POST(request({ reason: "spam" }), context());

    expect(response.status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
