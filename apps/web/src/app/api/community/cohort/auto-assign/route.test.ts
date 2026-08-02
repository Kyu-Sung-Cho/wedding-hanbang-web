import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  isTrustedMutationRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string, _request: Request, userId?: string) =>
    `${scope}:${userId ?? "anonymous"}`,
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: mocks.isTrustedMutationRequest,
}));

import { POST } from "./route";

describe("POST /api/community/cohort/auto-assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrustedMutationRequest.mockReturnValue(true);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        }),
      },
    });
  });

  it("rejects an untrusted browser mutation before authentication", async () => {
    mocks.isTrustedMutationRequest.mockReturnValue(false);

    const response = await POST(new Request(
      "https://hanbang.ai/api/community/cohort/auto-assign",
      { method: "POST" },
    ));

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated actor before any service-role lookup or write", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await POST(new Request(
      "https://hanbang.ai/api/community/cohort/auto-assign",
      { method: "POST" },
    ));

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:cohort:assign:11111111-1111-4111-8111-111111111111",
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("uses the atomic assignment RPC without follow-up membership or counter writes", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);

    const authClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        }),
      },
      from: vi.fn().mockReturnValue(query),
    };
    mocks.createClientFromRequest.mockResolvedValueOnce(authClient);
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(null);

    const serviceClient = {
      rpc: vi.fn().mockResolvedValue({
        data: "22222222-2222-4222-8222-222222222222",
        error: null,
      }),
      from: vi.fn(),
    };
    mocks.createAdminClient.mockReturnValueOnce(serviceClient);

    const response = await POST(new Request(
      "https://hanbang.ai/api/community/cohort/auto-assign",
      { method: "POST" },
    ));

    expect(response.status).toBe(200);
    expect(serviceClient.rpc).toHaveBeenCalledWith("community_assign_cohort", {
      p_user_id: "11111111-1111-4111-8111-111111111111",
      p_year: 2100,
      p_month: 10,
    });
    expect(serviceClient.from).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      room_id: "22222222-2222-4222-8222-222222222222",
      flexible: true,
    });
  });
});
