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
const SLOT_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "77777777-7777-4777-8777-777777777777";

function request(body: unknown = { reason_code: "temporary_unavailable" }) {
  return new NextRequest(
    `https://hanbang.ai/api/community/responder-capacity/${SLOT_ID}/revoke`,
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

describe("POST /api/community/responder-capacity/[slotId]/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("lets the authenticated owner revoke consent without consulting suspension state", async () => {
    const rpc = responderRpc({
      data: {
        slot_id: SLOT_ID,
        opt_in_status: "revoked",
        affected_request_id: REQUEST_ID,
      },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(request(), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      slot: {
        id: SLOT_ID,
        status: "revoked",
        affected_request_id: REQUEST_ID,
      },
    });
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:responder:capacity:revoke:${USER_ID}`,
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(rpc).toHaveBeenCalledWith(
      "community_revoke_responder_capacity_slot",
      {
        p_responder_id: USER_ID,
        p_slot_id: SLOT_ID,
        p_reason_code: "temporary_unavailable",
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
  });

  it("returns the exact stored revocation before the mutable rate gate", async () => {
    const receipt = {
      slot_id: SLOT_ID,
      opt_in_status: "revoked",
      affected_request_id: REQUEST_ID,
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
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      slot: {
        id: SLOT_ID,
        status: "revoked",
        affected_request_id: REQUEST_ID,
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("rejects an unknown revocation reason or caller-supplied actor before service access", async () => {
    const response = await POST(
      request({
        reason_code: "operator_requested",
        responder_id: "99999999-9999-4999-8999-999999999999",
      }),
      { params: Promise.resolve({ slotId: SLOT_ID }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_REQUEST_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a conflict when a revocation idempotency key is reused with another reason", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: null,
        error: {
          code: "22023",
          message: "capacity revocation idempotency key reused with different payload",
        },
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_IDEMPOTENCY_CONFLICT",
    });
  });

  it("fails closed without leaking service configuration errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("service secret and destination details");
    });

    const response = await POST(request(), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "COMMUNITY_RESPONDER_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("service secret");
    expect(errorSpy).toHaveBeenCalledWith("[community responder revoke] unavailable");
    errorSpy.mockRestore();
  });
});
