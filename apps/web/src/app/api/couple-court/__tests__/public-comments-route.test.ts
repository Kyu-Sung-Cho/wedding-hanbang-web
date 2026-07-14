import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn(),
  createClientFromRequest: vi.fn(),
  createCourtPublicCommentForUser: vi.fn(),
  listCourtPublicComments: vi.fn(),
  replayCourtPublicCommentForUser: vi.fn(),
  rateLimitKey: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  createCourtPublicCommentForUser: mocks.createCourtPublicCommentForUser,
  listCourtPublicComments: mocks.listCourtPublicComments,
  replayCourtPublicCommentForUser: mocks.replayCourtPublicCommentForUser,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { CourtApiError, encodeCourtCursor } from "../_shared";
import { GET, POST } from "../public/[postId]/comments/route";

const POST_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const COMMENT_ID = "00000000-0000-4000-8000-000000000003";
const SUBMISSION_REQUEST_ID = "00000000-0000-4000-8000-000000000005";
const context = { params: Promise.resolve({ postId: POST_ID }) };
const CURSOR = {
  at: "2026-07-14T01:02:03.123456+00:00",
  id: "00000000-0000-4000-8000-000000000004",
};

function request(body: Record<string, unknown>): Request {
  return new Request(`https://hanbang.ai/api/couple-court/public/${POST_ID}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://hanbang.ai",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/couple-court/public/[postId]/comments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    vi.stubEnv("COUPLE_COURT_PUBLIC_ENABLED", "true");
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.replayCourtPublicCommentForUser.mockResolvedValue({ found: false });
    mocks.rateLimitKey.mockReturnValue("couple-court:public:comment:user");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks a public comment containing personal information before persistence", async () => {
    const response = await POST(request({
      submission_request_id: SUBMISSION_REQUEST_ID,
      comment_type: "empathy",
      body: "예약자 김민수에게 010-1234-5678로 연락해 주세요.",
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COURT_COMMENT_PII_BLOCKED",
    });
    expect(mocks.createCourtPublicCommentForUser).not.toHaveBeenCalled();
  });

  it("persists and returns a valid public comment", async () => {
    const body = "비슷한 경험이 있어 마음이 많이 쓰였어요.";
    const comment = {
      comment_id: COMMENT_ID,
      moderation_status: "pending",
      reused: false,
    };
    mocks.createCourtPublicCommentForUser.mockResolvedValue(comment);

    const response = await POST(request({
      submissionRequestId: SUBMISSION_REQUEST_ID,
      comment_type: "empathy",
      body,
    }), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ comment });
    expect(mocks.createCourtPublicCommentForUser).toHaveBeenCalledWith({
      publicPostId: POST_ID,
      userId: USER_ID,
      submissionRequestId: SUBMISSION_REQUEST_ID,
      commentType: "empathy",
      body,
    });
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-uuid"],
  ])("rejects a %s submission request id before persistence", async (_label, submissionRequestId) => {
    const response = await POST(request({
      ...(submissionRequestId === undefined ? {} : { submissionRequestId }),
      commentType: "question",
      body: "어떤 합의를 이미 시도해 보셨나요?",
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "COURT_COMMENT_REQUEST_INVALID",
      error: "댓글 작성 요청을 다시 시작해 주세요.",
    });
    expect(mocks.createCourtPublicCommentForUser).not.toHaveBeenCalled();
  });

  it("rejects conflicting snake- and camel-case request identities", async () => {
    const response = await POST(request({
      submission_request_id: SUBMISSION_REQUEST_ID,
      submissionRequestId: "00000000-0000-4000-8000-000000000006",
      commentType: "question",
      body: "요청 ID가 두 개면 어느 것도 선택하지 않습니다.",
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COURT_COMMENT_REQUEST_INVALID",
    });
    expect(mocks.createCourtPublicCommentForUser).not.toHaveBeenCalled();
  });

  it("returns the exact replay contract with 200 and no second logical comment", async () => {
    const comment = {
      comment_id: COMMENT_ID,
      moderation_status: "pending",
      reused: true,
    };
    mocks.replayCourtPublicCommentForUser.mockResolvedValue({ found: true, ...comment });

    const response = await POST(request({
      submissionRequestId: SUBMISSION_REQUEST_ID,
      commentType: "empathy",
      body: "같은 요청을 그대로 다시 보냅니다.",
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ comment });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createCourtPublicCommentForUser).not.toHaveBeenCalled();
  });

  it("preserves a payload-mismatch conflict as an explicit API contract", async () => {
    mocks.replayCourtPublicCommentForUser.mockRejectedValue(new CourtApiError(
      409,
      "COURT_COMMENT_REQUEST_CONFLICT",
      "같은 댓글 작성 요청으로 다른 내용을 보낼 수 없어요.",
    ));

    const response = await POST(request({
      submissionRequestId: SUBMISSION_REQUEST_ID,
      commentType: "question",
      body: "요청 키를 다른 내용에 재사용합니다.",
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "COURT_COMMENT_REQUEST_CONFLICT",
      error: "같은 댓글 작성 요청으로 다른 내용을 보낼 수 없어요.",
    });
  });

  it("recovers a committed exact replay even when the new-write limiter is exhausted", async () => {
    const comment = {
      comment_id: COMMENT_ID,
      moderation_status: "visible",
      reused: true,
    };
    mocks.replayCourtPublicCommentForUser.mockResolvedValue({ found: true, ...comment });
    mocks.checkRateLimitPersistent.mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );

    const response = await POST(request({
      submissionRequestId: SUBMISSION_REQUEST_ID,
      commentType: "empathy",
      body: "응답을 잃은 마지막 허용 댓글을 복구합니다.",
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ comment });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("fails closed when storage violates the acknowledged comment contract", async () => {
    mocks.createCourtPublicCommentForUser.mockResolvedValue({
      comment_id: "not-a-uuid",
      moderation_status: "pending",
      reused: false,
    });

    const response = await POST(request({
      submissionRequestId: SUBMISSION_REQUEST_ID,
      commentType: "empathy",
      body: "저장 결과 계약을 확인합니다.",
    }), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "COURT_COMMENT_RESULT_INVALID",
      error: "댓글 저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요.",
    });
  });
});

describe("GET /api/couple-court/public/[postId]/comments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    vi.stubEnv("COUPLE_COURT_PUBLIC_ENABLED", "true");
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rateLimitKey.mockReturnValue("couple-court:public:comments:list");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes a validated keyset cursor and returns the next page cursor", async () => {
    const comment = {
      id: COMMENT_ID,
      public_post_id: POST_ID,
      comment_type: "empathy",
      body: "서로 한 문장씩 확인해 보면 좋겠어요.",
    };
    mocks.listCourtPublicComments.mockResolvedValue({
      items: [comment],
      nextCursor: CURSOR,
    });
    const encoded = encodeCourtCursor("comments", CURSOR);
    const response = await GET(new Request(
      `https://hanbang.ai/api/couple-court/public/${POST_ID}/comments?cursor=${encoded}`,
    ), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      comments: [comment],
      nextCursor: encoded,
    });
    expect(mocks.listCourtPublicComments).toHaveBeenCalledWith(POST_ID, 40, CURSOR);
  });

  it("rejects a malformed cursor before querying comments", async () => {
    const response = await GET(new Request(
      `https://hanbang.ai/api/couple-court/public/${POST_ID}/comments?cursor=invalid`,
    ), context);

    expect(response.status).toBe(400);
    expect(mocks.listCourtPublicComments).not.toHaveBeenCalled();
  });
});
