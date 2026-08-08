import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "couple-plan-change:active:test"),
}));

import { GET } from "./route";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "20000000-0000-4000-8000-000000000001";
const COUPLE_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "30000000-0000-4000-8000-000000000002";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";

function requestClient(
  userId: string | null = OWNER_ID,
  profileCoupleId: string | null = COUPLE_ID,
) {
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);
  profileQuery.single.mockResolvedValue({
    data: profileCoupleId === null ? null : { couple_id: profileCoupleId },
    error: null,
  });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: vi.fn().mockReturnValue(profileQuery),
  };
}

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    gt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.gt.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  return builder;
}

function adminClient(
  couples: { data: unknown; error: unknown },
  requests: { data: unknown; error: unknown },
) {
  const coupleQuery = query(couples);
  const requestQuery = query(requests);
  const from = vi.fn()
    .mockReturnValueOnce(coupleQuery)
    .mockReturnValueOnce(requestQuery);
  return { client: { from }, from, coupleQuery, requestQuery };
}

describe("GET /api/couple-plan-changes/active", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createClientFromRequest.mockResolvedValue(requestClient());
  });

  it("lists every unexpired pending schedule request for the exact current roster", async () => {
    const database = adminClient(
      {
        data: [{ id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID }],
        error: null,
      },
      {
        data: [{
          id: REQUEST_ID,
          actor_user_id: PARTNER_ID,
          created_at: "2026-08-02T01:00:00.000Z",
        }],
        error: null,
      },
    );
    mocks.createAdminClient.mockReturnValue(database.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active",
      { headers: { authorization: "Bearer native-session" } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(database.from).toHaveBeenNthCalledWith(1, "couples");
    expect(database.from).toHaveBeenNthCalledWith(
      2,
      "couple_plan_change_requests",
    );
    expect(database.coupleQuery.or).toHaveBeenCalledWith(
      `bride_id.eq.${OWNER_ID},groom_id.eq.${OWNER_ID}`,
    );
    expect(database.coupleQuery.limit).toHaveBeenCalledWith(2);
    expect(database.requestQuery.eq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(database.requestQuery.eq).toHaveBeenCalledWith("status", "pending");
    expect(database.requestQuery.eq).toHaveBeenCalledWith("required_count", 2);
    expect(database.requestQuery.eq).toHaveBeenCalledWith("surface_href", "/schedule");
    expect(database.requestQuery.gt).toHaveBeenCalledWith(
      "expires_at",
      expect.stringMatching(/^20\d\d-/),
    );
    expect(database.requestQuery.limit).toHaveBeenCalledWith(20);
    await expect(response.json()).resolves.toEqual({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      requests: [{
        requestId: REQUEST_ID,
        role: "reviewer",
        createdAt: "2026-08-02T01:00:00.000Z",
      }],
    });
  });

  it("returns a fail-closed budget recovery envelope only for the closed budget surface", async () => {
    const database = adminClient(
      {
        data: [{ id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID }],
        error: null,
      },
      {
        data: [{
          id: REQUEST_ID,
          actor_user_id: OWNER_ID,
          base_revision: 7,
          summary: "예식장 예산 변경",
          created_at: "2026-08-02T01:00:00.000Z",
        }],
        error: null,
      },
    );
    mocks.createAdminClient.mockReturnValue(database.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active?surface=%2Fbudget",
      { headers: { authorization: "Bearer native-session" } },
    ));

    expect(response.status).toBe(200);
    expect(database.requestQuery.select).toHaveBeenCalledWith(
      "id, actor_user_id, base_revision, summary, created_at",
    );
    expect(database.requestQuery.eq).toHaveBeenCalledWith(
      "surface_href",
      "/budget",
    );
    await expect(response.json()).resolves.toEqual({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      surface: "/budget",
      requests: [{
        requestId: REQUEST_ID,
        role: "requester",
        baseRevision: 7,
        summary: "예식장 예산 변경",
        createdAt: "2026-08-02T01:00:00.000Z",
      }],
    });
  });

  it.each([
    { base_revision: "7", summary: "예식장 예산 변경" },
    { base_revision: 7, summary: " 위험한 공백" },
    { base_revision: 7, summary: "위험\u202e요약" },
  ])("fails closed on an unsafe budget recovery row: %#", async (fields) => {
    const database = adminClient(
      {
        data: [{ id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID }],
        error: null,
      },
      {
        data: [{
          id: REQUEST_ID,
          actor_user_id: OWNER_ID,
          created_at: "2026-08-02T01:00:00.000Z",
          ...fields,
        }],
        error: null,
      },
    );
    mocks.createAdminClient.mockReturnValue(database.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active?surface=%2Fbudget",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.not.toHaveProperty("requests");
  });

  it.each([
    "?surface=%2Fdashboard",
    "?surface=%2Fbudget&surface=%2Fschedule",
    "?surface=%2Fbudget&ownerId=someone-else",
  ])("rejects an unsupported or ambiguous active-query contract: %s", async (queryString) => {
    const response = await GET(new Request(
      `https://hanbang.ai/api/couple-plan-changes/active${queryString}`,
    ));

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a stale roster slot that does not match the owner's current profile couple", async () => {
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(OWNER_ID, OTHER_COUPLE_ID),
    );
    const database = adminClient(
      {
        data: [{ id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID }],
        error: null,
      },
      {
        data: [{
          id: REQUEST_ID,
          actor_user_id: OWNER_ID,
          base_revision: 7,
          summary: "이전 커플의 예산 변경",
          created_at: "2026-08-02T01:00:00.000Z",
        }],
        error: null,
      },
    );
    mocks.createAdminClient.mockReturnValue(database.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active?surface=%2Fbudget",
    ));

    expect(response.status).toBe(409);
    expect(database.from).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.not.toHaveProperty("requests");
  });

  it("fails closed when one account appears in more than one roster", async () => {
    const database = adminClient(
      {
        data: [
          { id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID },
          {
            id: "30000000-0000-4000-8000-000000000002",
            bride_id: OWNER_ID,
            groom_id: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    mocks.createAdminClient.mockReturnValue(database.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active",
    ));

    expect(response.status).toBe(409);
    expect(database.from).toHaveBeenCalledTimes(1);
  });

  it("rejects an active request whose actor is outside the current roster", async () => {
    const database = adminClient(
      {
        data: [{ id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID }],
        error: null,
      },
      {
        data: [{
          id: REQUEST_ID,
          actor_user_id: "50000000-0000-4000-8000-000000000001",
          created_at: "2026-08-02T01:00:00.000Z",
        }],
        error: null,
      },
    );
    mocks.createAdminClient.mockReturnValue(database.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("does not open the service-role client without an authenticated owner", async () => {
    mocks.createClientFromRequest.mockResolvedValue(requestClient(null));

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active",
    ));

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns the fail-closed persistent limiter response without querying rosters", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
    );

    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-plan-changes/active",
    ));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
