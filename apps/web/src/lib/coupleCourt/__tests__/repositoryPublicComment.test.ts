import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

import {
  createCourtPublicCommentForUser,
  replayCourtPublicCommentForUser,
} from "@/lib/coupleCourt/repository";

const POST_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const REQUEST_ID = "00000000-0000-4000-8000-000000000003";

function createComment() {
  return createCourtPublicCommentForUser({
    publicPostId: POST_ID,
    userId: USER_ID,
    submissionRequestId: REQUEST_ID,
    commentType: "empathy",
    body: "서로의 말을 한 문장씩 확인해 보면 좋겠어요.",
  });
}

describe("createCourtPublicCommentForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("checks the read-only replay RPC with the same exact identity", async () => {
    const result = {
      found: true,
      comment_id: "00000000-0000-4000-8000-000000000004",
      moderation_status: "pending",
      reused: true,
    };
    mocks.rpc.mockResolvedValue({ data: result, error: null });

    await expect(replayCourtPublicCommentForUser({
      publicPostId: POST_ID,
      userId: USER_ID,
      submissionRequestId: REQUEST_ID,
      commentType: "empathy",
      body: "서로의 말을 한 문장씩 확인해 보면 좋겠어요.",
    })).resolves.toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledWith("replay_court_public_comment", {
      p_public_post_id: POST_ID,
      p_user_id: USER_ID,
      p_submission_request_id: REQUEST_ID,
      p_comment_type: "empathy",
      p_body: "서로의 말을 한 문장씩 확인해 보면 좋겠어요.",
    });
  });

  it("passes the durable submission identity to the five-argument RPC", async () => {
    const result = {
      comment_id: "00000000-0000-4000-8000-000000000004",
      moderation_status: "pending",
      reused: false,
    };
    mocks.rpc.mockResolvedValue({ data: result, error: null });

    await expect(createComment()).resolves.toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledWith("create_court_public_comment", {
      p_public_post_id: POST_ID,
      p_user_id: USER_ID,
      p_submission_request_id: REQUEST_ID,
      p_comment_type: "empathy",
      p_body: "서로의 말을 한 문장씩 확인해 보면 좋겠어요.",
    });
  });

  it("maps request-key payload reuse to a stable 409 instead of a generic validation error", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "court_comment_submission_request_mismatch",
      },
    });

    await expect(createComment()).rejects.toMatchObject({
      status: 409,
      code: "COURT_COMMENT_REQUEST_CONFLICT",
      message: "같은 댓글 작성 요청으로 다른 내용을 보낼 수 없어요.",
    });
  });
});
