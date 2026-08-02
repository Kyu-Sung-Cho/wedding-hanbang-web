// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn((scope: string, _request: Request, userId?: string) =>
    `${scope}:${userId ?? "anonymous"}`),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET, POST } from "./route";

const ROOM_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_USERS = [
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
  "20000000-0000-4000-8000-000000000005",
] as const;

function membershipQuery(active = true) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: active ? { id: "membership" } : null,
    error: null,
  });
  return chain;
}

function setAuthenticatedUser(userId = USER_ID, active = true) {
  const membership = membershipQuery(active);
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
    },
    from: vi.fn((table: string) => {
      if (table !== "cohort_members") throw new Error(`unexpected auth table: ${table}`);
      return membership;
    }),
  });
  return membership;
}

function listQuery(data: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  return chain;
}

function contractRows(userIds: readonly string[]) {
  return userIds.map((userId, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    category: "studio",
    created_at: `2026-08-0${index + 1}T00:00:00.000Z`,
    user_id: userId,
    vendor_name: `vendor-${index + 1}`,
    base_price: (index + 1) * 100,
    extra_price: null,
    notes: null,
  }));
}

function serviceForGet(rows: unknown[], stats: unknown[]) {
  const activeMembersQuery = listQuery(
    [USER_ID, ...OTHER_USERS].map((userId) => ({ user_id: userId })),
  );
  const contractsQuery = listQuery(rows);
  const statsQuery = listQuery(stats);
  const from = vi.fn((table: string) => {
    if (table === "cohort_members") return activeMembersQuery;
    if (table === "cohort_contracts") return contractsQuery;
    if (table === "cohort_stats") return statsQuery;
    throw new Error(`unexpected service table: ${table}`);
  });
  const client = { from, rpc: vi.fn() };
  mocks.createAdminClient.mockReturnValue(client);
  return { client, activeMembersQuery, contractsQuery, statsQuery };
}

function request(method: "GET" | "POST", body?: unknown, expectedActor = USER_ID) {
  const headers = new Headers({
    cookie: "sb-session=test",
    "x-hanbang-expected-actor": expectedActor,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://hanbang.ai/api/community/cohort/${ROOM_ID}/contracts`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as Parameters<typeof GET>[0];
}

const context = { params: Promise.resolve({ id: ROOM_ID }) };

describe("GET /api/community/cohort/[id]/contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    setAuthenticatedUser();
  });

  it("never exposes averages when the independent distinct-user count is below five", async () => {
    const rows = contractRows([USER_ID, ...OTHER_USERS.slice(0, 3)]);
    serviceForGet(rows, [{
      room_id: ROOM_ID,
      category: "studio",
      sample_size: 5,
      avg_base_price: 999,
      avg_extra_price: 999,
      avg_total: 999,
    }]);

    const response = await GET(request("GET"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(body.stats).toEqual([{
      room_id: ROOM_ID,
      category: "studio",
      sample_size: 4,
    }]);
    expect(JSON.stringify(body.stats)).not.toContain("avg_");
    expect(body.contracts).toBeUndefined();
    expect(body.contract_count).toBe(4);
    expect(JSON.stringify(body)).not.toContain(rows[1]?.id);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:cohort-contracts:list:${USER_ID}`,
      { maxRequests: 60, windowMs: 60 * 1000 },
      { failClosed: true },
    );
  });

  it("releases the explicit aggregate projection at five matching contributors", async () => {
    const rows = contractRows([USER_ID, ...OTHER_USERS]);
    const service = serviceForGet(rows, [{
      room_id: ROOM_ID,
      category: "studio",
      sample_size: 5,
      avg_base_price: 300,
      avg_extra_price: null,
      avg_total: 300,
    }]);

    const response = await GET(request("GET"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stats).toEqual([{
      room_id: ROOM_ID,
      category: "studio",
      sample_size: 5,
      avg_base_price: 300,
      avg_extra_price: null,
      avg_total: 300,
    }]);
    expect(service.contractsQuery.limit).toHaveBeenCalledWith(241);
    expect(service.statsQuery.limit).toHaveBeenCalledWith(9);
    expect(service.activeMembersQuery.limit).toHaveBeenCalledWith(31);
  });

  it("redacts averages if a duplicate actor row appears despite the database constraint", async () => {
    const rows = contractRows([USER_ID, ...OTHER_USERS]);
    rows.push({
      ...rows[0]!,
      id: "30000000-0000-4000-8000-000000000099",
      base_price: 99_999,
    });
    serviceForGet(rows, [{
      room_id: ROOM_ID,
      category: "studio",
      sample_size: 5,
      avg_base_price: 16_916,
      avg_extra_price: null,
      avg_total: 16_916,
    }]);

    const response = await GET(request("GET"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stats).toEqual([{
      room_id: ROOM_ID,
      category: "studio",
      sample_size: 5,
    }]);
    expect(JSON.stringify(body.stats)).not.toContain("avg_");
  });

  it("fails closed before service-role reads when the persistent limiter is unavailable", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    );

    const response = await GET(request("GET"), context);

    expect(response.status).toBe(503);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/community/cohort/[id]/contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    setAuthenticatedUser();
  });

  it("rejects an expected-actor mismatch before rate limits or service access", async () => {
    const response = await POST(
      request("POST", {
        vendor_name: "vendor",
        category: "venue",
        base_price: 100,
      }, OTHER_USERS[0]),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("uses only the service RPC and binds both actor parameters to the verified user", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: "30000000-0000-4000-8000-000000000001",
        room_id: ROOM_ID,
        user_id: USER_ID,
        vendor_name: "vendor",
        category: "venue",
        base_price: 100,
        extra_price: 10,
        notes: "memo",
        created_at: "2026-08-02T00:00:00.000Z",
      },
      error: null,
    });
    const from = vi.fn();
    mocks.createAdminClient.mockReturnValue({ rpc, from });

    const response = await POST(
      request("POST", {
        vendor_name: " vendor ",
        category: "venue",
        base_price: 100,
        extra_price: 10,
        notes: "memo",
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("community_upsert_cohort_contract", {
      p_expected_user_id: USER_ID,
      p_user_id: USER_ID,
      p_room_id: ROOM_ID,
      p_vendor_name: "vendor",
      p_category: "venue",
      p_base_price: 100,
      p_extra_price: 10,
      p_notes: "memo",
    });
    expect(from).not.toHaveBeenCalled();
    expect(body.contract.user_id).toBeUndefined();
    expect(body.contract.room_id).toBe(ROOM_ID);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:cohort-contracts:upsert:${USER_ID}`,
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
  });

  it("rejects out-of-range totals before creating a service client", async () => {
    const response = await POST(
      request("POST", {
        vendor_name: "vendor",
        category: "venue",
        base_price: 90_000,
        extra_price: 10_001,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects JSON type coercion before creating a service client", async () => {
    const response = await POST(
      request("POST", {
        vendor_name: "vendor",
        category: "venue",
        base_price: false,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed before membership or service writes when the limiter is unavailable", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    );

    const response = await POST(
      request("POST", {
        vendor_name: "vendor",
        category: "venue",
        base_price: 100,
      }),
      context,
    );

    expect(response.status).toBe(503);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
