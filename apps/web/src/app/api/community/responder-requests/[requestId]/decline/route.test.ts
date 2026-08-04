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
const IDEMPOTENCY_KEY = "66666666-6666-4666-8666-666666666666";

function request(body: unknown = {
  commercial_relationship: "none",
  has_conflict: false,
  decline_reason_code: "not_available",
}) {
  return new NextRequest(
    `https://hanbang.ai/api/community/responder-requests/${REQUEST_ID}/decline`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
        "sec-fetch-site": "same-origin",
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

describe("POST /api/community/responder-requests/[requestId]/decline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("lets an authenticated responder decline without consulting suspension state", async () => {
    const rpc = responderRpc({
      data: {
        request_id: REQUEST_ID,
        status: "declined",
        question_state: "private_waitlist",
      },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(200);
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:responder:request:decline:${USER_ID}`,
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(rpc).toHaveBeenCalledWith(
      "community_respond_responder_request",
      {
        p_responder_id: USER_ID,
        p_request_id: REQUEST_ID,
        p_decision: "decline",
        p_commercial_relationship: "none",
        p_has_conflict: false,
        p_decline_reason_code: "not_available",
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
  });

  it("returns the exact stored decline before the mutable rate gate", async () => {
    const receipt = {
      request_id: REQUEST_ID,
      status: "declined",
      question_state: "private_waitlist",
    };
    const rpc = responderRpc(
      { data: null, error: new Error("mutation must not run") },
      { data: receipt, error: null },
    );
    mocks.createAdminClient.mockReturnValue({ rpc });
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
        status: "declined",
        question_state: "private_waitlist",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("rejects a contradictory conflict disclosure before service access", async () => {
    const response = await POST(
      request({
        commercial_relationship: "none",
        has_conflict: true,
        decline_reason_code: "not_available",
      }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_REQUEST_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns not found when the service cannot bind the request to this responder", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: null,
        error: { code: "P0002", message: "responder request not found" },
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ requestId: REQUEST_ID }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_TARGET_NOT_FOUND",
    });
  });

  it("passes an explicit conflict decline atomically so the database can revoke the slot", async () => {
    const rpc = responderRpc({
      data: {
        request_id: REQUEST_ID,
        status: "declined",
        question_state: "private_waitlist",
      },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(
      request({
        commercial_relationship: "affiliate",
        has_conflict: true,
        decline_reason_code: "conflict",
      }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "community_respond_responder_request",
      expect.objectContaining({
        p_responder_id: USER_ID,
        p_commercial_relationship: "affiliate",
        p_has_conflict: true,
        p_decline_reason_code: "conflict",
      }),
    );
  });
});
