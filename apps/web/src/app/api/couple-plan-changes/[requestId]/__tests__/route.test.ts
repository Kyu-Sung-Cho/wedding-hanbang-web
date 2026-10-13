// @vitest-environment node

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  checkRateLimit,
  checkRateLimitPersistent,
} from "@/utils/rateLimit";
import { DELETE, GET, POST } from "../route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  user: {
    id: "11111111-1111-4111-8111-111111111111",
  } as { id: string } | null,
  profile: {
    couple_id: "22222222-2222-4222-8222-222222222222",
  } as { couple_id: string | null } | null,
  profileError: null as unknown,
  authFrom: vi.fn(),
  rpc: vi.fn(),
}));

function queryResult(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => ({ data, error }));
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mocks.user } })),
    },
    from: mocks.authFrom,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "couple-plan-change:test"),
}));

function context(requestId = REQUEST_ID) {
  return { params: Promise.resolve({ requestId }) };
}

function mutationRequest(method: "POST" | "DELETE", body: unknown = {}) {
  return new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`, {
    method,
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function result(status: "applied" | "pending_partner" | "stale" | "rejected") {
  return {
    requestId: REQUEST_ID,
    status,
    requiredCount: 2,
    acceptedCount: status === "pending_partner" ? 1 : 2,
    summary: "총예산: 40000000원",
    surface: "/budget",
    ...(status === "applied"
      ? {
          journey: {
            id: "44444444-4444-4444-8444-444444444444",
            couple_id: COUPLE_ID,
            state_revision: 8,
          },
        }
      : { journey: null }),
  };
}

describe("/api/couple-plan-changes/[requestId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: USER_ID };
    mocks.profile = { couple_id: COUPLE_ID };
    mocks.profileError = null;
    mocks.authFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return queryResult(mocks.profile, mocks.profileError);
      }
      throw new Error(`unexpected auth table: ${table}`);
    });
    vi.mocked(checkRateLimit).mockReturnValue(null);
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ data: result("pending_partner"), error: null });
  });

  it("does not present a retired pending action writer as a retryable storage outage", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "AMORA_ACTION_RESERVED_PLAN_WRITER_RETIRED", details: "SYNTHETIC private SQL detail" },
    });
    const response = await POST(mutationRequest("POST"), context());
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ code: "AMORA_ACTION_VIEW_REQUIRED", error: expect.stringContaining("결정 보드") });
    expect(body).not.toHaveProperty("journey");
    expect(JSON.stringify(body)).not.toContain("SYNTHETIC private SQL detail");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("gets the request status using only the authenticated couple scope", async () => {
    const response = await GET(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: "pending_partner",
      summary: "총예산: 40000000원",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "get_couple_plan_change_status",
      {
        p_request_id: REQUEST_ID,
        p_couple_id: COUPLE_ID,
        p_actor_user_id: USER_ID,
      },
    );
  });

  it("accepts an empty object and returns 200 with the applied journey", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: result("applied"), error: null });

    const response = await POST(mutationRequest("POST"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: "applied",
      journey: expect.objectContaining({ couple_id: COUPLE_ID }),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("accept_couple_plan_change", {
      p_request_id: REQUEST_ID,
      p_couple_id: COUPLE_ID,
      p_actor_user_id: USER_ID,
    });
  });

  it("returns 202 when this acceptance still awaits the partner", async () => {
    const response = await POST(mutationRequest("POST"), context());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: "pending_partner",
    });
  });

  it("rejects the pending request through the scoped reject RPC", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: result("rejected"), error: null });

    const response = await DELETE(mutationRequest("DELETE"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: "rejected",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("reject_couple_plan_change", {
      p_request_id: REQUEST_ID,
      p_couple_id: COUPLE_ID,
      p_actor_user_id: USER_ID,
    });
  });

  it("reports stale mutation results as conflicts while GET still reports durable state", async () => {
    mocks.rpc.mockResolvedValue({ data: result("stale"), error: null });

    const mutation = await POST(mutationRequest("POST"), context());
    expect(mutation.status).toBe(409);
    await expect(mutation.json()).resolves.toMatchObject({
      status: "stale",
      code: "PLAN_CHANGE_STALE",
    });

    const read = await GET(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`),
      context(),
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ status: "stale" });
  });

  it("rejects malformed request ids before authentication or service access", async () => {
    const response = await GET(
      new Request("http://localhost/api/couple-plan-changes/not-a-uuid"),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects cross-site mutations before authentication", async () => {
    const response = await POST(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: "{}",
      }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown keys", { userId: USER_ID }],
    ["an array body", []],
    ["a scalar body", true],
  ])("rejects %s in a mutation body", async (_label, body) => {
    const response = await POST(mutationRequest("POST", body), context());

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized streamed mutation bodies", async () => {
    const malformed = await POST(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`, {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: "{",
      }),
      context(),
    );
    expect(malformed.status).toBe(400);

    const oversizedRequest = new Request(
      `http://localhost/api/couple-plan-changes/${REQUEST_ID}`,
      {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ padding: "x".repeat(3_000) }),
      },
    );
    expect(oversizedRequest.headers.get("content-length")).toBeNull();
    const oversized = await POST(oversizedRequest, context());
    expect(oversized.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated/unlinked callers and rate limits authenticated callers", async () => {
    mocks.user = null;
    const unauthenticated = await GET(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`),
      context(),
    );
    expect(unauthenticated.status).toBe(401);

    vi.clearAllMocks();
    mocks.user = { id: USER_ID };
    mocks.profile = { couple_id: null };
    mocks.authFrom.mockImplementation(() => queryResult(mocks.profile));
    vi.mocked(checkRateLimit).mockReturnValue(null);
    const unlinked = await GET(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`),
      context(),
    );
    expect(unlinked.status).toBe(403);

    vi.clearAllMocks();
    mocks.profile = { couple_id: COUPLE_ID };
    mocks.authFrom.mockImplementation(() => queryResult(mocks.profile));
    vi.mocked(checkRateLimit).mockReturnValueOnce(
      NextResponse.json({ error: "limited" }, { status: 429 }),
    );
    const limited = await GET(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`),
      context(),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toContain("no-store");
    expect(mocks.authFrom).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the shared fail-closed limiter for approval mutations", async () => {
    vi.mocked(checkRateLimitPersistent).mockResolvedValueOnce(
      NextResponse.json({ error: "limited" }, { status: 429 }),
    );

    const response = await POST(mutationRequest("POST"), context());

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.authFrom).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps known service failures without exposing database details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "COUPLE_PLAN_CHANGE_NOT_FOUND" },
    });
    const missing = await GET(
      new Request(`http://localhost/api/couple-plan-changes/${REQUEST_ID}`),
      context(),
    );
    expect(missing.status).toBe(404);

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "secret database detail" },
    });
    const unavailable = await POST(mutationRequest("POST"), context());
    const body = await unavailable.json();
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("secret database detail");
  });

  it("fails closed on malformed or cross-couple service results", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...result("applied"),
        journey: {
          couple_id: "55555555-5555-4555-8555-555555555555",
          state_revision: 8,
        },
      },
      error: null,
    });

    const response = await POST(mutationRequest("POST"), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    [
      "an applied result without every required acceptance",
      {
        ...result("applied"),
        acceptedCount: 1,
      },
    ],
    [
      "an impossible solo pending result",
      {
        ...result("pending_partner"),
        requiredCount: 1,
      },
    ],
    [
      "a pending result that leaks a journey snapshot",
      {
        ...result("pending_partner"),
        journey: {
          couple_id: COUPLE_ID,
          state_revision: 8,
        },
      },
    ],
  ])("fails closed on %s", async (_label, serviceResult) => {
    mocks.rpc.mockResolvedValueOnce({ data: serviceResult, error: null });

    const response = await POST(mutationRequest("POST"), context());

    expect(response.status).toBe(503);
  });
});
