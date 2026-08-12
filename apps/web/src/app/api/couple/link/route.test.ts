import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userRpc: vi.fn(),
  adminRpc: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(() => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { role: "groom" }, error: null }),
      }),
    }),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.userRpc,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.adminRpc })),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "couple-link:test"),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

import { POST } from "./route";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

function request(headers: Record<string, string> = {}) {
  return new Request("https://hanbang.ai/api/couple/link", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ inviteCode: "WH-ABC123" }),
  });
}

describe("POST /api/couple/link service-only join boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: ACTOR_ID } },
      error: null,
    });
    mocks.userRpc.mockRejectedValue(new Error("legacy RPC must not be called"));
  });

  it("passes only the verified actor to the service-only join RPC", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: {
        success: true,
        joined: true,
        idempotent: false,
        actor_user_id: ACTOR_ID,
        couple_id: COUPLE_ID,
        invite_code: "WH-ABC123",
        role: "groom",
      },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith("join_couple_server", {
      p_actor_user_id: ACTOR_ID,
      p_invite_code: "WH-ABC123",
      p_role: "groom",
    });
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("accepts a matching v2 initiating actor", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: {
        success: true,
        joined: true,
        idempotent: false,
        actor_user_id: ACTOR_ID,
        couple_id: COUPLE_ID,
        invite_code: "WH-ABC123",
        role: "groom",
      },
      error: null,
    });

    const response = await POST(request({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: ACTOR_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
  });

  it("rejects an account-switched v2 request before any membership lookup or write", async () => {
    const response = await POST(request({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: "00000000-0000-4000-8000-000000000099",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MUTATION_ACTOR_CHANGED" });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fails closed when Phase A has not been expanded instead of falling back", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function is absent" },
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COUPLE_INVITE_EXPAND_REQUIRED",
    });
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("rejects a service receipt that echoes a different actor", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: {
        success: true,
        joined: true,
        idempotent: false,
        actor_user_id: "00000000-0000-4000-8000-000000000099",
        couple_id: COUPLE_ID,
        invite_code: "WH-ABC123",
        role: "groom",
      },
      error: null,
    });

    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });
});
