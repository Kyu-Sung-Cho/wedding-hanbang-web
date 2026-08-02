import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitKey: vi.fn(() => "community-ai-comment:test"),
  createServiceClient: vi.fn(),
  createOpenAIResponse: vi.fn(),
  reserveAmoraTurn: vi.fn(),
  providerGeneration: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimit,
  rateLimitKey: mocks.rateLimitKey,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createServiceClient,
}));

vi.mock("@/lib/ai/auditedOpenAI", () => ({
  createOpenAIResponseWithAudit: mocks.createOpenAIResponse,
}));

vi.mock("@/lib/ai/costGuard", () => ({
  reserveAmoraTurn: mocks.reserveAmoraTurn,
}));

function request(): NextRequest {
  return new NextRequest("http://localhost/api/community/ai-comment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId: "post-1" }),
  });
}

function chunkedOversizeRequest(byteLength: number): Request {
  const firstChunkSize = Math.floor(byteLength / 2);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(firstChunkSize).fill(0x7b));
      controller.enqueue(new Uint8Array(byteLength - firstChunkSize).fill(0x7d));
      controller.close();
    },
  });
  return new Request("http://localhost/api/community/ai-comment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function mockServiceClientForGeneration(options: { primaryInsertFails?: boolean } = {}) {
  const postRead = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: "post-1",
        title: "예식장 계약 조언",
        content: "계약서를 확인할 때 무엇을 봐야 하나요?",
        category: "tips_v2",
        cost_data: null,
        price_data: null,
        tags: ["계약"],
        author_id: "member-1",
      },
      error: null,
    }),
  };
  postRead.select.mockReturnValue(postRead);
  postRead.eq.mockReturnValue(postRead);

  const existingCommentRead = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  existingCommentRead.select.mockReturnValue(existingCommentRead);
  existingCommentRead.eq.mockReturnValue(existingCommentRead);

  const profileRead = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { user_id: "00000000-0000-0000-0000-000000000000" },
      error: null,
    }),
  };
  profileRead.select.mockReturnValue(profileRead);
  profileRead.eq.mockReturnValue(profileRead);

  const commentSingle = vi.fn();
  if (options.primaryInsertFails) {
    commentSingle
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column is_ai does not exist" },
      })
      .mockResolvedValueOnce({
        data: { id: "comment-fallback", post_id: "post-1", content: "안전한 계약 조언 [amora_cta]" },
        error: null,
      });
  } else {
    commentSingle.mockResolvedValue({
      data: { id: "comment-1", post_id: "post-1", content: "안전한 계약 조언 [amora_cta]" },
      error: null,
    });
  }

  const commentInsert = {
    insert: vi.fn(),
    select: vi.fn(),
    single: commentSingle,
  };
  commentInsert.insert.mockReturnValue(commentInsert);
  commentInsert.select.mockReturnValue(commentInsert);

  let commentCalls = 0;
  const serviceClient = {
    from: vi.fn((table: string) => {
      if (table === "community_posts") return postRead;
      if (table === "community_comments") {
        commentCalls += 1;
        return commentCalls === 1 ? existingCommentRead : commentInsert;
      }
      if (table === "community_profiles") return profileRead;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  mocks.createServiceClient.mockReturnValue(serviceClient);
  mocks.createOpenAIResponse.mockImplementation(async (options: {
    beforeGeneration?: () => void | Promise<void>;
  }) => {
    await options.beforeGeneration?.();
    mocks.providerGeneration();
    return {
      text: "안전한 계약 조언 [amora_cta]",
      model: "gpt-5.6-luna",
      usageStatus: "complete",
    };
  });

  return serviceClient;
}

describe("POST /api/community/ai-comment safety gates", () => {
  const previousEnabled = process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED;
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.checkRateLimit.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (previousEnabled === undefined) {
      delete process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED;
    } else {
      process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED = previousEnabled;
    }
    vi.restoreAllMocks();
  });

  it("checks administrator authorization before revealing the disabled feature", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false, userId: null });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.createOpenAIResponse).not.toHaveBeenCalled();
  });

  it("defaults the feature off and stops before any DB or model call", async () => {
    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "COMMUNITY_AI_COMMENT_DISABLED",
    }));
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.createOpenAIResponse).not.toHaveBeenCalled();
    expect(mocks.reserveAmoraTurn).not.toHaveBeenCalled();
  });

  it("returns 413 for a Content-Length-less chunked oversized JSON body", async () => {
    process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED = "true";
    const oversized = chunkedOversizeRequest(2 * 1024 + 1);

    const response = await POST(oversized as never);

    expect(oversized.headers.get("content-length")).toBeNull();
    expect(response.status).toBe(413);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.createOpenAIResponse).not.toHaveBeenCalled();
  });

  it("reserves one Luna background call immediately before generation", async () => {
    process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED = "true";
    const serviceClient = mockServiceClientForGeneration();
    mocks.reserveAmoraTurn.mockResolvedValue({ allowed: true });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.createOpenAIResponse).toHaveBeenCalledWith(expect.objectContaining({
      modelRole: "fast",
      maxInputTokens: 64_000,
      maxOutputTokens: 300,
      beforeGeneration: expect.any(Function),
    }));
    expect(mocks.reserveAmoraTurn).toHaveBeenCalledWith(serviceClient, {
      coupleId: "00000000-0000-0000-0000-000000000000",
      isAdmin: false,
      quotaScope: "background",
      maxCostMicrousd: 88_400,
    });
    expect(mocks.reserveAmoraTurn.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.providerGeneration.mock.invocationCallOrder[0]
    );
  });

  it("keeps the legacy is_ai fallback on trigger-owned counters", async () => {
    process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED = "true";
    const serviceClient = mockServiceClientForGeneration({ primaryInsertFails: true });
    mocks.reserveAmoraTurn.mockResolvedValue({ allowed: true });

    const response = await POST(request());

    expect(response.status).toBe(201);
    const communityCommentCalls = serviceClient.from.mock.calls.filter(
      ([table]) => table === "community_comments",
    );
    const communityPostCalls = serviceClient.from.mock.calls.filter(
      ([table]) => table === "community_posts",
    );
    expect(communityCommentCalls).toHaveLength(3);
    expect(communityPostCalls).toHaveLength(1);
  });

  it("fails closed with 503 when the atomic cost reservation is denied", async () => {
    process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED = "true";
    mockServiceClientForGeneration();
    mocks.reserveAmoraTurn.mockResolvedValue({ allowed: false, reason: "global_budget" });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "COMMUNITY_AI_COMMENT_UNAVAILABLE",
    }));
    expect(mocks.providerGeneration).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when cost reservation throws", async () => {
    process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED = "true";
    mockServiceClientForGeneration();
    mocks.reserveAmoraTurn.mockRejectedValue(new Error("reservation unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.providerGeneration).not.toHaveBeenCalled();
  });
});
