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
const IDEMPOTENCY_KEY = "22222222-2222-4222-8222-222222222222";
const SLOT_ID = "33333333-3333-4333-8333-333333333333";
const AVAILABLE_FROM = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const AVAILABLE_UNTIL = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

function validBody() {
  return {
    responder_origin: "member",
    topic: "contract_extra_cost",
    experience_scope: "contract_terms",
    experience_period: "within_6_months",
    commercial_relationship: "none",
    has_conflict: false,
    available_from: AVAILABLE_FROM,
    available_until: AVAILABLE_UNTIL,
    weekly_request_limit: 2,
    cooldown_hours: 24,
    max_open_requests: 1,
  };
}

function request(body: unknown = validBody(), headers: HeadersInit = {}) {
  return new NextRequest("https://hanbang.ai/api/community/responder-capacity", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function authenticatedClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
  };
}

function responderRpc(
  mutation: { data: unknown; error: unknown },
  replay: { data: unknown; error: unknown } = { data: null, error: null },
) {
  return vi.fn(async (name: string) =>
    name === "community_replay_responder_command_service" ? replay : mutation
  );
}

describe("POST /api/community/responder-capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("binds a valid capacity registration to the authenticated actor through the service RPC", async () => {
    const rpc = responderRpc({
      data: {
        slot_id: SLOT_ID,
        responder_id: USER_ID,
        topic: "contract_extra_cost",
        experience_scope: "contract_terms",
        experience_period: "within_6_months",
        opt_in_status: "active",
        eligibility_status: "pending_review",
        available_from: AVAILABLE_FROM,
        available_until: AVAILABLE_UNTIL,
      },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      slot: { id: SLOT_ID, status: "active", review_status: "pending_review" },
    });
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:responder:capacity:register:${USER_ID}`,
      { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(rpc).toHaveBeenCalledWith(
      "community_register_responder_capacity_slot",
      {
        p_responder_id: USER_ID,
        p_responder_origin: "member",
        p_topic: "contract_extra_cost",
        p_experience_scope: "contract_terms",
        p_experience_period: "within_6_months",
        p_commercial_relationship: "none",
        p_has_conflict: false,
        p_available_from: AVAILABLE_FROM,
        p_available_until: AVAILABLE_UNTIL,
        p_weekly_request_limit: 2,
        p_cooldown_hours: 24,
        p_max_open_requests: 1,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
  });

  it("fails closed when the database rejects an ineligible or agent-backed responder", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: null,
        error: {
          code: "42501",
          message: "eligible human responder required",
        },
      }),
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_NOT_ELIGIBLE",
    });
  });

  it("returns a recoverable conflict when an idempotency key is reused with another payload", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: null,
        error: {
          code: "22023",
          message: "capacity idempotency key reused with different payload",
        },
      }),
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_IDEMPOTENCY_CONFLICT",
    });
  });

  it("uses the shared JSON-only mutation boundary before constructing the service client", async () => {
    const response = await POST(request(validBody(), { "content-type": "text/plain" }));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_CONTENT_TYPE_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a syntactically shaped but impossible calendar timestamp", async () => {
    const response = await POST(request({
      ...validBody(),
      available_from: "2028-02-30T00:00:00Z",
      available_until: "2028-03-30T00:00:00Z",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_BODY_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed on an unknown service result state", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: {
          slot_id: SLOT_ID,
          responder_id: USER_ID,
          topic: "contract_extra_cost",
          experience_scope: "contract_terms",
          experience_period: "within_6_months",
          opt_in_status: "silently_enabled",
          eligibility_status: "trusted_without_review",
          available_from: AVAILABLE_FROM,
          available_until: AVAILABLE_UNTIL,
        },
        error: null,
      }),
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_CAPACITY_SAVE_FAILED",
    });
  });

  it("rejects a non-replayed registration that skips pending review", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: {
          slot_id: SLOT_ID,
          responder_id: USER_ID,
          topic: "contract_extra_cost",
          experience_scope: "contract_terms",
          experience_period: "within_6_months",
          opt_in_status: "active",
          eligibility_status: "verified_human_experience",
          available_from: AVAILABLE_FROM,
          available_until: AVAILABLE_UNTIL,
        },
        error: null,
      }),
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_CAPACITY_SAVE_FAILED",
    });
  });

  it("rejects a caller-supplied responder actor field", async () => {
    const response = await POST(request({
      ...validBody(),
      responder_id: "99999999-9999-4999-8999-999999999999",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_BODY_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("bounds the streamed JSON body even without trusting Content-Length", async () => {
    const oversized = request({
      ...validBody(),
      padding: "x".repeat(5 * 1024),
    });
    oversized.headers.delete("content-length");

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_BODY_TOO_LARGE",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin cookie-style mutation before authentication", async () => {
    const response = await POST(request(validBody(), {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_ORIGIN_REJECTED",
    });
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns an exact idempotent replay as the original 201 receipt before mutable gates", async () => {
    const receipt = {
        slot_id: SLOT_ID,
        responder_id: USER_ID,
        topic: "contract_extra_cost",
        experience_scope: "contract_terms",
        experience_period: "within_6_months",
        opt_in_status: "active",
        eligibility_status: "pending_review",
        available_from: AVAILABLE_FROM,
        available_until: AVAILABLE_UNTIL,
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

    const response = await POST(request());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      slot: {
        id: SLOT_ID,
        topic: "contract_extra_cost",
        experience_scope: "contract_terms",
        experience_period: "within_6_months",
        status: "active",
        review_status: "pending_review",
        available_from: AVAILABLE_FROM,
        available_until: AVAILABLE_UNTIL,
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("accepts a native Bearer mutation without browser origin metadata", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: responderRpc({
        data: {
          slot_id: SLOT_ID,
          responder_id: USER_ID,
          topic: "contract_extra_cost",
          experience_scope: "contract_terms",
          experience_period: "within_6_months",
          opt_in_status: "active",
          eligibility_status: "pending_review",
          available_from: AVAILABLE_FROM,
          available_until: AVAILABLE_UNTIL,
        },
        error: null,
      }),
    });
    const nativeRequest = request();
    nativeRequest.headers.delete("sec-fetch-site");
    nativeRequest.headers.set("authorization", "bEaReR native-access-token");

    const response = await POST(nativeRequest);

    expect(response.status).toBe(201);
    expect(mocks.createClientFromRequest).toHaveBeenCalledWith(nativeRequest);
  });

  it.each([
    ["weekly request limit", { weekly_request_limit: 8 }],
    ["cooldown hours", { cooldown_hours: 0 }],
    ["open request limit", { max_open_requests: 4 }],
    ["availability order", {
      available_from: AVAILABLE_UNTIL,
      available_until: AVAILABLE_FROM,
    }],
    ["expired availability", {
      available_from: "2025-01-01T00:00:00Z",
      available_until: "2025-02-01T00:00:00Z",
    }],
    ["availability longer than 366 days", {
      available_from: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      available_until: new Date(Date.now() + 367 * 24 * 60 * 60 * 1000).toISOString(),
    }],
  ])("rejects an out-of-contract %s", async (_label, override) => {
    const response = await POST(request({ ...validBody(), ...override }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_RESPONDER_BODY_INVALID",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
