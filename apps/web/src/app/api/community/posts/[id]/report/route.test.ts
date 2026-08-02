import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkRateLimitPersistent: vi.fn(async () => null),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true as const })),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "report-key"),
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));

import { POST } from "./route";

function request(reason = "privacy") {
  return new NextRequest("http://localhost/api/community/posts/post-1/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason, details: "전화번호가 보여요." }),
  });
}

function service({
  authorId = "author-1",
  visibility = "public",
  underReview = false,
  postError = null,
  insertError = null,
}: {
  authorId?: string;
  visibility?: string;
  underReview?: boolean;
  postError?: { code?: string } | null;
  insertError?: { code?: string } | null;
} = {}) {
  const postQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: postError
        ? null
        : {
            id: "post-1",
            author_id: authorId,
            visibility,
            under_review: underReview,
          },
      error: postError,
    })),
  };
  postQuery.select.mockReturnValue(postQuery);
  postQuery.eq.mockReturnValue(postQuery);

  const reportQuery = {
    insert: vi.fn(async () => ({ error: insertError })),
  };

  return {
    client: {
      from: vi.fn((table: string) =>
        table === "community_posts" ? postQuery : reportQuery,
      ),
    },
    reportQuery,
  };
}

describe("POST /api/community/posts/[id]/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "reporter-1" } } })),
      },
    });
  });

  it("accepts a privacy report for a readable post", async () => {
    const mock = service();
    mocks.createAdminClient.mockReturnValue(mock.client);

    const response = await POST(request(), {
      params: Promise.resolve({ id: "post-1" }),
    });

    expect(response.status).toBe(200);
    expect(mock.reportQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        reporter_id: "reporter-1",
        post_id: "post-1",
        comment_id: null,
        reason: "privacy",
      }),
    );
  });

  it("does not let an author report their own post", async () => {
    const mock = service({ authorId: "reporter-1" });
    mocks.createAdminClient.mockReturnValue(mock.client);

    const response = await POST(request(), {
      params: Promise.resolve({ id: "post-1" }),
    });

    expect(response.status).toBe(400);
    expect(mock.reportQuery.insert).not.toHaveBeenCalled();
  });

  it("maps the database uniqueness fence to a recoverable conflict", async () => {
    const mock = service({ insertError: { code: "23505" } });
    mocks.createAdminClient.mockReturnValue(mock.client);

    const response = await POST(request(), {
      params: Promise.resolve({ id: "post-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_REPORT_DUPLICATE");
  });

  it("does not disclose a post hidden for review to another member", async () => {
    const mock = service({ underReview: true });
    mocks.createAdminClient.mockReturnValue(mock.client);

    const response = await POST(request(), {
      params: Promise.resolve({ id: "post-1" }),
    });

    expect(response.status).toBe(404);
    expect(mock.reportQuery.insert).not.toHaveBeenCalled();
  });
});
