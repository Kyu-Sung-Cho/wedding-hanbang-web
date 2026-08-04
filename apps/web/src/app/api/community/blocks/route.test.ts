import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "community:user-block:set:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

import { GET, POST } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const BLOCKED_USER_ID = "10000000-0000-4000-8000-000000000002";

function getRequest() {
  return new NextRequest("https://hanbang.ai/api/community/blocks");
}

function postRequest(body: unknown) {
  return new NextRequest("https://hanbang.ai/api/community/blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userClient(options?: {
  userId?: string | null;
  rpcData?: unknown;
  rpcError?: { code?: string; message?: string } | null;
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: options?.userId === null
            ? null
            : { id: options?.userId ?? USER_ID },
        },
      }),
    },
    rpc: vi.fn().mockResolvedValue({
      data: options?.rpcData ?? [],
      error: options?.rpcError ?? null,
    }),
  };
}

function adminClient(
  profiles: unknown[] = [],
  rpcData: unknown = null,
  options: {
    profileError?: { code?: string; message?: string } | null;
    rpcError?: { code?: string; message?: string } | null;
  } = {},
) {
  const inQuery = vi.fn().mockResolvedValue({
    data: profiles,
    error: options.profileError ?? null,
  });
  const select = vi.fn(() => ({ in: inQuery }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({
    data: rpcData,
    error: options.rpcError ?? null,
  });
  return { from, select, inQuery, rpc };
}

describe("/api/community/blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createAdminClient.mockReturnValue(adminClient());
  });

  it("returns only the authenticated owner's private block list", async () => {
    const client = userClient({
      rpcData: [{
        blocked_user_id: BLOCKED_USER_ID,
        reason_category: "safety",
        created_at: "2026-08-04T01:00:00.000Z",
      }],
    });
    const admin = adminClient([{
      user_id: BLOCKED_USER_ID,
      nickname: "차단한 회원",
      avatar_url: null,
      rank: "sprout",
    }]);
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(body.ownerId).toBe(USER_ID);
    expect(body.blocks).toEqual([{
      blocked_user_id: BLOCKED_USER_ID,
      reason_category: "safety",
      created_at: "2026-08-04T01:00:00.000Z",
      profile: {
        user_id: BLOCKED_USER_ID,
        nickname: "차단한 회원",
        avatar_url: null,
        rank: "sprout",
      },
    }]);
    expect(client.rpc).toHaveBeenCalledWith(
      "community_list_user_blocks",
    );
  });

  it("fails closed on a malformed list receipt and never exposes a cast row", async () => {
    const client = userClient({
      rpcData: [{
        blocked_user_id: BLOCKED_USER_ID,
        reason_category: "safety",
        created_at: "2026-08-04T01:00:00.000Z",
        blocker_user_id: USER_ID,
      }],
    });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("COMMUNITY_BLOCK_LIST_UNAVAILABLE");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("logs only content-free categories and codes for private block failures", async () => {
    const secret = `private-block-detail:${BLOCKED_USER_ID}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mocks.createClientFromRequest.mockResolvedValue(userClient({
      rpcError: { code: "BLOCK_LIST_DOWN", message: secret },
    }));
    const listFailure = await GET(getRequest());
    expect(listFailure.status).toBe(503);

    mocks.createClientFromRequest.mockResolvedValue(userClient({
      rpcData: [{
        blocked_user_id: BLOCKED_USER_ID,
        reason_category: "safety",
        created_at: "2026-08-04T01:00:00.000Z",
      }],
    }));
    mocks.createAdminClient.mockReturnValue(adminClient([], null, {
      profileError: { code: "PROFILE_DOWN", message: secret },
    }));
    const profileFailure = await GET(getRequest());
    expect(profileFailure.status).toBe(200);

    mocks.createClientFromRequest.mockResolvedValue(userClient());
    mocks.createAdminClient.mockReturnValue(adminClient([], null, {
      rpcError: { code: "BLOCK_WRITE_DOWN", message: secret },
    }));
    const writeFailure = await POST(postRequest({
      blocked_user_id: BLOCKED_USER_ID,
      blocked: true,
    }));
    expect(writeFailure.status).toBe(503);

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).toContain("BLOCK_LIST_DOWN");
    expect(logged).toContain("PROFILE_DOWN");
    expect(logged).toContain("BLOCK_WRITE_DOWN");
    errorSpy.mockRestore();
  });

  it("requires authentication before reading or writing", async () => {
    const client = userClient({ userId: null });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const getResponse = await GET(getRequest());
    const postResponse = await POST(postRequest({
      blocked_user_id: BLOCKED_USER_ID,
      blocked: true,
    }));

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("sets explicit block intent through the authenticated atomic RPC", async () => {
    const client = userClient({
      rpcData: null,
    });
    const service = adminClient([], {
      ok: true,
      blocked_user_id: BLOCKED_USER_ID,
      blocked: true,
      changed: true,
    });
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(service);

    const response = await POST(postRequest({
      blocked_user_id: BLOCKED_USER_ID,
      blocked: true,
      reason_category: "unwanted_contact",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      blocked_user_id: BLOCKED_USER_ID,
      blocked: true,
      changed: true,
    });
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledOnce();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(service.rpc).toHaveBeenCalledWith("community_set_user_block", {
      p_actor_id: USER_ID,
      p_blocked_user_id: BLOCKED_USER_ID,
      p_blocked: true,
      p_reason_category: "unwanted_contact",
    });
  });

  it("rejects self-block, unknown fields, and invalid receipts", async () => {
    const client = userClient({
      rpcData: null,
    });
    const service = adminClient([], {
      ok: true,
      blocked_user_id: BLOCKED_USER_ID,
      blocked: false,
      changed: true,
    });
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(service);

    const selfResponse = await POST(postRequest({
      blocked_user_id: USER_ID,
      blocked: true,
    }));
    const unknownResponse = await POST(postRequest({
      blocked_user_id: BLOCKED_USER_ID,
      blocked: true,
      reveal_to_target: true,
    }));
    const invalidReceiptResponse = await POST(postRequest({
      blocked_user_id: BLOCKED_USER_ID,
      blocked: true,
    }));
    const invalidReceiptBody = await invalidReceiptResponse.json();

    expect(selfResponse.status).toBe(400);
    expect(unknownResponse.status).toBe(400);
    expect(invalidReceiptResponse.status).toBe(503);
    expect(invalidReceiptBody.code).toBe("COMMUNITY_BLOCK_INVALID_RECEIPT");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(service.rpc).toHaveBeenCalledTimes(1);
  });
});
