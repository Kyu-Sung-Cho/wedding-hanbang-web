// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";

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
  rateLimitKey: (prefix: string, _request: Request, userId?: string) => `${prefix}:${userId}`,
}));

import { POST as assignCohort } from "@/app/api/community/cohort/route";
import { POST as updateWeddingDate } from "@/app/api/community/profile/wedding-date/route";

type AssignmentHandler = typeof assignCohort;

function request(body: unknown) {
  return new Request("https://hanbang.ai/api/community/cohort", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://hanbang.ai",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe.each([
  ["explicit cohort", assignCohort],
  ["wedding date", updateWeddingDate],
] as const)("%s assignment route", (_name, handler: AssignmentHandler) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
    });
  });

  it("fails closed at the shared persistent assignment limiter before service-role work", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await handler(request({ year: 2027, month: 5 }) as never);

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:cohort:assign:${USER_ID}`,
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before creating a service-role client", async () => {
    mocks.createClientFromRequest.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await handler(request({ year: 2027, month: 5 }) as never);

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("normalizes the quarter and commits through the canonical RPC", async () => {
    const serviceClient = {
      rpc: vi.fn().mockResolvedValue({ data: ROOM_ID, error: null }),
      from: vi.fn(),
    };
    mocks.createAdminClient.mockReturnValue(serviceClient);

    const response = await handler(request({ year: 2027, month: 5 }) as never);

    expect(response.status).toBe(200);
    expect(serviceClient.rpc).toHaveBeenCalledOnce();
    expect(serviceClient.rpc).toHaveBeenCalledWith("community_assign_cohort", {
      p_user_id: USER_ID,
      p_year: 2027,
      p_month: 4,
    });
    expect(serviceClient.from).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      room_id: ROOM_ID,
      year: 2027,
      quarter: 2,
      month: 4,
    });
  });

  it("rejects fractional dates before creating a service-role client", async () => {
    const response = await handler(request({ year: 2027.5, month: 4.5 }) as never);

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC does not return a UUID", async () => {
    const serviceClient = {
      rpc: vi.fn().mockResolvedValue({ data: "not-a-room-id", error: null }),
      from: vi.fn(),
    };
    mocks.createAdminClient.mockReturnValue(serviceClient);

    const response = await handler(request({ year: 2027, month: 5 }) as never);

    expect(response.status).toBe(500);
    expect(serviceClient.from).not.toHaveBeenCalled();
  });
});
