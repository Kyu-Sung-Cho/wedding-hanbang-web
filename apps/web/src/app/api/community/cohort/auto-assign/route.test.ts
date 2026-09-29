// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: mocks.createClientFromRequest }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: () => "cohort-test",
  checkRateLimitPersistent: async () => null,
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: async () => ({ allowed: true }),
}));

import { POST } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const ROOM_ID = "30000000-0000-4000-8000-000000000001";
type ReadResult = { data: unknown; error: { message: string } | null };

function client(overrides: Record<string, ReadResult> = {}) {
  const results: Record<string, ReadResult> = {
    cohort_members: { data: [], error: null },
    profiles: { data: { couple_id: COUPLE_ID }, error: null },
    wedding_journeys: { data: { wedding_date: "2026-12-10" }, error: null },
    ...overrides,
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(async () => results[table]),
        maybeSingle: vi.fn(async () => results[table]),
      };
      return query;
    }),
  };
}

function request() {
  return new Request("https://hanbang.ai/api/community/cohort/auto-assign", {
    method: "POST",
    headers: { Origin: "https://hanbang.ai" },
  });
}

describe("automatic cohort assignment read failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue(client());
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: ROOM_ID, error: null });
  });

  it.each(["cohort_members", "profiles", "wedding_journeys"])(
    "stops before privileged assignment when the %s lookup fails",
    async (table) => {
      mocks.createClientFromRequest.mockResolvedValue(client({
        [table]: { data: null, error: { message: "temporary database outage" } },
      }));

      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({ room_id: null, reason: "lookup_failed" });
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("returns an existing membership without looking up a new target", async () => {
    const viewer = client({ cohort_members: { data: [{ room_id: ROOM_ID }], error: null } });
    mocks.createClientFromRequest.mockResolvedValue(viewer);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ room_id: ROOM_ID, reason: "already_assigned" });
    expect(viewer.from).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps genuine missing wedding information eligible for the flexible room", async () => {
    mocks.createClientFromRequest.mockResolvedValue(client({
      wedding_journeys: { data: null, error: null },
    }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ room_id: ROOM_ID, flexible: true });
    expect(mocks.rpc).toHaveBeenCalledWith("community_assign_cohort", {
      p_user_id: USER_ID, p_year: 2100, p_month: 10,
    });
  });

  it("uses successfully read wedding timing for a new membership", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("community_assign_cohort", {
      p_user_id: USER_ID, p_year: 2026, p_month: 10,
    });
  });
});
