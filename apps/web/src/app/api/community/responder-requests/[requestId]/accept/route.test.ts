import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkCommunityWriteAccess: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn((prefix: string, _request: Request, userId?: string) =>
    `${prefix}:${userId ?? "anonymous"}`
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
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
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";

function request(
  body: unknown = {
    commercial_relationship: "none",
    has_conflict: false,
  },
  headers: HeadersInit = {},
) {
  return new NextRequest(
    `https://hanbang.ai/api/community/responder-requests/${REQUEST_ID}/accept`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function responderRpc(
  mutation: { data: unknown; error: unknown },
  replay: { data: unknown; error: unknown } = { data: null, error: null },
) {
  return vi.fn(async (name: string) =>
    name === "community_replay_responder_command_service" ? replay : mutation
  );
}

describe("POST /api/community/responder-requests/[requestId]/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
    });
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({ data: null, error: null }),
    });
  });

  it("accepts only as the authenticated responder through the service RPC", async () => {
    const rpc = responderRpc({
      data: {
        request_id: REQUEST_ID,
        status: "accepted",
        question_state: "private_waitlist",
      },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      request: {
        id: REQUEST_ID,
        status: "accepted",
        question_state: "private_waitlist",
      },
    });
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:responder:request:accept:${USER_ID}`,
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(rpc).toHaveBeenCalledWith(
      "community_respond_responder_request",
      {
        p_responder_id: USER_ID,
        p_request_id: REQUEST_ID,
        p_decision: "accept",
        p_commercial_relationship: "none",
        p_has_conflict: false,
        p_decline_reason_code: null,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
  });

  it("returns the exact stored acceptance before suspension and rate gates", async () => {
    const receipt = {
      request_id: REQUEST_ID,
      status: "accepted",
      question_state: "private_waitlist",
    };
    const rpc = responderRpc(
      { data: null, error: new Error("mutation must not run") },
      { data: receipt, error: null },
    );
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
      message: "suspended",
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(
      Response.json({ code: "RATE_LIMITED" }, { status: 429 }) as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      request: {
        id: REQUEST_ID,
        status: "accepted",
        question_state: "private_waitlist",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "community_replay_responder_command_service",
      {
        p_actor_id: USER_ID,
        p_operation: "respond_request",
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_payload: {
          request_id: REQUEST_ID,
          decision: "accept",
          commercial_relationship: "none",
          has_conflict: false,
          decline_reason_code: null,
        },
      },
    );
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type before constructing the service client", async () => {
    const response = await POST(
      request(undefined, { "content-type": "text/plain" }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) },
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_CONTENT_TYPE_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed authenticated actor before rate limiting or service access", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "not-a-user-uuid" } } })),
      },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_AUTH_INVALID",
    });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed on the persistent rate-limit gate before service access", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(
      Response.json(
        { code: "RATE_LIMIT_STORE_UNAVAILABLE" },
        { status: 503, headers: { "Retry-After": "60" } },
      ),
    );

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("blocks a suspended responder before accept reaches the service RPC", async () => {
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
      message: "현재 커뮤니티 작성 기능을 사용할 수 없어요.",
    });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_SUSPENDED",
    });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("maps the database human-eligibility fence for an agent-backed responder to 403", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: null,
        error: { code: "42501", message: "eligible human responder required" },
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_NOT_ELIGIBLE",
    });
  });

  it("keeps the database runtime fence fail-closed even if the proxy is bypassed", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: null,
        error: {
          code: "55000",
          message: "community responder supply is not accepting new work",
        },
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_RUNTIME_BLOCKED",
    });
  });

  it("treats a missing verified service boundary as an outage, not a user eligibility failure", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: null,
        error: {
          code: "42501",
          message: "verified service responder actor required",
        },
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_SERVICE_BOUNDARY_UNAVAILABLE",
    });
  });

  it("fails closed when the service result does not match the requested command", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: {
          request_id: "99999999-9999-4999-8999-999999999999",
          status: "accepted",
          question_state: "published_without_review",
        },
        error: null,
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_RESPONSE_INVALID",
    });
  });

  it("fails closed when a stored acceptance receipt has the wrong target", async () => {
    const rpc = responderRpc(
      { data: null, error: new Error("mutation must not run") },
      {
        data: {
          request_id: "99999999-9999-4999-8999-999999999999",
          status: "accepted",
          question_state: "private_waitlist",
        },
        error: null,
      },
    );
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_RECEIPT_UNAVAILABLE",
    });
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("rejects acceptance when the responder declares a conflict", async () => {
    const response = await POST(
      request({ commercial_relationship: "none", has_conflict: true }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_REQUEST_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
