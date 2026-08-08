import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  canReadCommunityPost: vi.fn(() => true),
  checkCommunityWriteAccess: vi.fn(
    async (): Promise<
      | { allowed: true }
      | {
          allowed: false;
          status: 403 | 503;
          code:
            | "COMMUNITY_SUSPENDED"
            | "COMMUNITY_WRITE_ACCESS_UNAVAILABLE";
          message: string;
        }
    > => ({ allowed: true }),
  ),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "comment-report-rate-key"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/community/publicPostRules", () => ({
  canReadCommunityPost: mocks.canReadCommunityPost,
}));

vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "44444444-4444-4444-8444-444444444444";

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
};

function request(body: unknown = { reason: "privacy" }) {
  return new Request(
    `http://localhost/api/community/comments/${COMMENT_ID}/report`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
    },
  );
}

function requestClient(options: {
  userId?: string | null;
  comment?: QueryResult;
  post?: QueryResult;
} = {}) {
  const commentResult = options.comment ?? {
    data: {
      id: COMMENT_ID,
      post_id: POST_ID,
      author_id: AUTHOR_ID,
      is_deleted: false,
      content_origin: "member",
    },
    error: null,
  };
  const postResult = options.post ?? {
    data: {
      id: POST_ID,
      author_id: AUTHOR_ID,
      visibility: "public",
      under_review: false,
    },
    error: null,
  };

  const commentMaybeSingle = vi.fn(async () => commentResult);
  const postMaybeSingle = vi.fn(async () => postResult);
  const from = vi.fn((table: string) => {
    const maybeSingle =
      table === "community_comments"
        ? commentMaybeSingle
        : table === "community_posts"
          ? postMaybeSingle
          : null;
    if (!maybeSingle) throw new Error(`Unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    };
  });

  return {
    client: {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user:
              options.userId === null
                ? null
                : { id: options.userId ?? USER_ID },
          },
        })),
      },
      from,
    },
    commentMaybeSingle,
    postMaybeSingle,
  };
}

function adminClient(options: {
  existing?: Record<string, unknown> | null;
  duplicateError?: { code?: string; message?: string } | null;
  insertError?: { code?: string; message?: string } | null;
} = {}) {
  const duplicateMaybeSingle = vi.fn(async () => ({
    data: options.existing ?? null,
    error: options.duplicateError ?? null,
  }));
  const insert = vi.fn(async () => ({
    data: null,
    error: options.insertError ?? null,
  }));
  const from = vi.fn((table: string) => {
    if (table !== "community_reports") {
      throw new Error(`Unexpected admin table: ${table}`);
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: duplicateMaybeSingle })),
        })),
      })),
      insert,
    };
  });

  return { client: { from }, insert, duplicateMaybeSingle };
}

async function callRoute(body?: unknown) {
  return POST(request(body) as never, {
    params: Promise.resolve({ id: COMMENT_ID }),
  });
}

describe("community comment report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canReadCommunityPost.mockReturnValue(true);
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("requires login before checking or writing a report", async () => {
    const { client } = requestClient({ userId: null });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await callRoute();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_AUTH_REQUIRED",
    });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a cross-site cookie-authenticated mutation before auth", async () => {
    const crossSiteRequest = new Request(
      `http://localhost/api/community/comments/${COMMENT_ID}/report`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://outside.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ reason: "privacy" }),
      },
    );

    const response = await POST(crossSiteRequest as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_REPORT_ORIGIN_REJECTED",
    });
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("preserves the shared suspension fence response", async () => {
    const { client } = requestClient();
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
      message: "현재 커뮤니티 작성 기능을 사용할 수 없어요.",
    });

    const response = await callRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "현재 커뮤니티 작성 기능을 사용할 수 없어요.",
      code: "COMMUNITY_SUSPENDED",
    });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("rejects reporting one's own answer before service-role access", async () => {
    const { client } = requestClient({
      comment: {
        data: {
          id: COMMENT_ID,
          post_id: POST_ID,
          author_id: USER_ID,
          is_deleted: false,
          content_origin: "member",
        },
        error: null,
      },
    });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await callRoute();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_SELF_REPORT_NOT_ALLOWED",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the content-origin migration is unavailable", async () => {
    const { client } = requestClient({
      comment: {
        data: null,
        error: {
          code: "42703",
          message: "column content_origin does not exist",
        },
      },
    });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await callRoute();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_REPORT_SCHEMA_UNAVAILABLE",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not accept a report when its parent post is inaccessible", async () => {
    const { client } = requestClient();
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.canReadCommunityPost.mockReturnValue(false);

    const response = await callRoute();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_COMMENT_NOT_FOUND",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("accepts a privacy report and writes only the comment target", async () => {
    const { client } = requestClient();
    const admin = adminClient();
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await callRoute({
      reason: "privacy",
      details: "<b>연락처가 보여요</b>",
    });

    expect(response.status).toBe(201);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "comment-report-rate-key",
      { maxRequests: 5, windowMs: 60 * 60 * 1000 },
    );
    expect(admin.insert).toHaveBeenCalledWith({
      reporter_id: USER_ID,
      post_id: null,
      comment_id: COMMENT_ID,
      reason: "privacy",
      description: "연락처가 보여요",
      status: "pending",
    });
  });

  it("maps both a prior report and a unique-index race to a recoverable 409", async () => {
    const { client } = requestClient();
    mocks.createClientFromRequest.mockResolvedValue(client);

    const prior = adminClient({ existing: { id: "report-1" } });
    mocks.createAdminClient.mockReturnValueOnce(prior.client);
    const priorResponse = await callRoute();
    expect(priorResponse.status).toBe(409);
    await expect(priorResponse.json()).resolves.toMatchObject({
      code: "COMMUNITY_REPORT_ALREADY_EXISTS",
    });

    const raced = adminClient({ insertError: { code: "23505" } });
    mocks.createAdminClient.mockReturnValueOnce(raced.client);
    const raceResponse = await callRoute();
    expect(raceResponse.status).toBe(409);
    await expect(raceResponse.json()).resolves.toMatchObject({
      code: "COMMUNITY_REPORT_ALREADY_EXISTS",
    });
  });
});
