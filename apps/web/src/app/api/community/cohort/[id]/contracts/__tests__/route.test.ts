import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import { GET, POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn((scope: string, _request: Request, subject: string) =>
    `${scope}:${subject}`
  ),
}));

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONTRACT_ID = "33333333-3333-4333-8333-333333333333";

type ContractRow = {
  id: string;
  room_id: string;
  vendor_name: string;
  category: string;
  base_price: number;
  extra_price: number | null;
  notes: string | null;
  created_at: string;
};

type AggregateRow = {
  category: unknown;
  sample_size: unknown;
  avg_base_price: unknown;
  avg_extra_price: unknown;
  avg_total: unknown;
};

function request(method: "GET" | "POST", body?: Record<string, unknown>) {
  return new NextRequest(
    `http://localhost/api/community/cohort/${ROOM_ID}/contracts`,
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }
  );
}

function context() {
  return { params: Promise.resolve({ id: ROOM_ID }) };
}

function mockRlsClient({
  userId = USER_ID,
  isMember = true,
  membershipError = null,
  contracts = [],
  contractsError = null,
  insertedContract = null,
  insertError = null,
}: {
  userId?: string | null;
  isMember?: boolean;
  membershipError?: unknown;
  contracts?: ContractRow[];
  contractsError?: unknown;
  insertedContract?: ContractRow | null;
  insertError?: unknown;
} = {}) {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: isMember ? { id: "membership-1" } : null,
      error: membershipError,
    }),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);

  let insertedPayload: Record<string, unknown> | null = null;
  const contractQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({
      data: contracts,
      error: contractsError,
    }),
    insert: vi.fn((payload: Record<string, unknown>) => {
      insertedPayload = payload;
      return contractQuery;
    }),
    single: vi.fn().mockResolvedValue({
      data: insertedContract,
      error: insertError,
    }),
  };
  contractQuery.select.mockReturnValue(contractQuery);
  contractQuery.eq.mockReturnValue(contractQuery);

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "cohort_members") return membershipQuery;
      if (table === "cohort_contracts") return contractQuery;
      throw new Error(`Unexpected RLS table access: ${table}`);
    }),
  };

  vi.mocked(createClientFromRequest).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClientFromRequest>>
  );

  return {
    client,
    membershipQuery,
    contractQuery,
    getInsertedPayload: () => insertedPayload,
  };
}

function mockAggregateClient({
  contributorCount = 5,
  thresholdMet = true,
  stats = [],
  contributorError = null,
  statsError = null,
}: {
  contributorCount?: number;
  thresholdMet?: boolean;
  stats?: AggregateRow[];
  contributorError?: unknown;
  statsError?: unknown;
} = {}) {
  const contributorQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        contributor_count: contributorCount,
        threshold_met: thresholdMet,
      },
      error: contributorError,
    }),
  };
  contributorQuery.select.mockReturnValue(contributorQuery);
  contributorQuery.eq.mockReturnValue(contributorQuery);

  const statsQuery = {
    select: vi.fn(),
    eq: vi.fn().mockResolvedValue({ data: stats, error: statsError }),
  };
  statsQuery.select.mockReturnValue(statsQuery);

  const admin = {
    from: vi.fn((table: string) => {
      if (table === "cohort_room_contributor_stats") return contributorQuery;
      if (table === "cohort_stats") return statsQuery;
      throw new Error(`Unexpected admin table access: ${table}`);
    }),
  };

  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>
  );

  return { admin, contributorQuery, statsQuery };
}

describe("/api/community/cohort/[id]/contracts behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an unauthenticated reader before membership or aggregate access", async () => {
    const { client } = mockRlsClient({ userId: null });

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-member before reading contracts or aggregates", async () => {
    const { client, membershipQuery } = mockRlsClient({ isMember: false });

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(403);
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(membershipQuery.eq).toHaveBeenCalledWith("room_id", ROOM_ID);
    expect(membershipQuery.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  for (const method of ["GET", "POST"] as const) {
    it(`reports a retryable failure when ${method} membership lookup fails`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { contractQuery } = mockRlsClient({
        membershipError: { code: "08006", details: "database unavailable" },
      });

      const response = method === "GET"
        ? await GET(request("GET"), context())
        : await POST(request("POST", {
            vendor_name: "Studio A",
            category: "studio",
            base_price: 300,
          }), context());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "동기방 멤버를 확인하지 못했습니다.",
      });
      expect(contractQuery.insert).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
    });
  }

  it("returns only the member's RLS-visible contracts and never admin-reads raw contracts", async () => {
    const ownContract: ContractRow = {
      id: CONTRACT_ID,
      room_id: ROOM_ID,
      vendor_name: "Studio A",
      category: "studio",
      base_price: 300,
      extra_price: 20,
      notes: "Album included",
      created_at: "2026-07-13T00:00:00.000Z",
    };
    const { client } = mockRlsClient({ contracts: [ownContract] });
    const { admin } = mockAggregateClient();

    const response = await GET(request("GET"), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.my_contracts).toEqual([ownContract]);
    expect(client.from).toHaveBeenCalledWith("cohort_contracts");
    expect(admin.from).not.toHaveBeenCalledWith("cohort_contracts");
    expect(admin.from).toHaveBeenCalledWith("cohort_room_contributor_stats");
    expect(admin.from).toHaveBeenCalledWith("cohort_stats");
  });

  it("omits four-person aggregate rows and suppresses the contributor count", async () => {
    mockRlsClient();
    mockAggregateClient({
      contributorCount: 4,
      thresholdMet: false,
      stats: [
        {
          category: "studio",
          sample_size: 4,
          avg_base_price: 300,
          avg_extra_price: 20,
          avg_total: 320,
        },
      ],
    });

    const response = await GET(request("GET"), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.stats).toEqual([]);
    expect(payload.total_contributor_count).toBeNull();
    expect(payload.total_contributor_count_suppressed).toBe(true);
  });

  it("emits authorized five-person aggregates including a 2,000,000 total", async () => {
    mockRlsClient();
    mockAggregateClient({
      contributorCount: 5,
      thresholdMet: true,
      stats: [
        {
          category: "venue",
          sample_size: 5,
          avg_base_price: 1_000_000,
          avg_extra_price: 1_000_000,
          avg_total: 2_000_000,
        },
      ],
    });

    const response = await GET(request("GET"), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.stats).toEqual([
      {
        category: "venue",
        sample_size: 5,
        avg_base_price: 1_000_000,
        avg_extra_price: 1_000_000,
        avg_total: 2_000_000,
      },
    ]);
    expect(payload.total_contributor_count).toBe(5);
    expect(payload.total_contributor_count_suppressed).toBe(false);
  });

  it("fails closed when the database aggregate query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRlsClient();
    mockAggregateClient({ statsError: { message: "aggregate unavailable" } });

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(500);
  });

  it("rejects an invalid POST body without attempting a contract write", async () => {
    const { contractQuery } = mockRlsClient();

    const response = await POST(
      request("POST", {
        vendor_name: "Studio A",
        category: "unsupported",
        base_price: 300,
      }),
      context()
    );

    expect(response.status).toBe(400);
    expect(contractQuery.insert).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("validates and writes a member's contract through the RLS client", async () => {
    const insertedContract: ContractRow = {
      id: CONTRACT_ID,
      room_id: ROOM_ID,
      vendor_name: "Studio A",
      category: "studio",
      base_price: 300,
      extra_price: null,
      notes: "Album included",
      created_at: "2026-07-13T00:00:00.000Z",
    };
    const { client, getInsertedPayload } = mockRlsClient({ insertedContract });

    const response = await POST(
      request("POST", {
        vendor_name: "  Studio A  ",
        category: "studio",
        base_price: 300,
        extra_price: "",
        notes: "  Album included  ",
      }),
      context()
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.contract).toEqual(insertedContract);
    expect(getInsertedPayload()).toEqual({
      room_id: ROOM_ID,
      user_id: USER_ID,
      vendor_name: "Studio A",
      category: "studio",
      base_price: 300,
      extra_price: null,
      notes: "Album included",
    });
    expect(client.from).toHaveBeenCalledWith("cohort_contracts");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rateLimitKey).toHaveBeenCalledWith(
      "community:cohort-contracts:create",
      expect.any(NextRequest),
      USER_ID
    );
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:cohort-contracts:create:${USER_ID}`,
      { maxRequests: 20, windowMs: 60_000 },
      USER_ID
    );
  });

  it("never writes private quote fields or database details to server logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRlsClient({
      insertError: {
        code: "23514",
        message: "private-vendor-name",
        details: "private-price-and-notes",
      },
    });

    const response = await POST(
      request("POST", {
        vendor_name: "private-vendor-name",
        category: "studio",
        base_price: 300,
        notes: "private-price-and-notes",
      }),
      context()
    );
    const serializedCalls = JSON.stringify(consoleError.mock.calls);

    expect(response.status).toBe(500);
    expect(serializedCalls).toContain("23514");
    expect(serializedCalls).not.toContain("private-vendor-name");
    expect(serializedCalls).not.toContain("private-price-and-notes");
  });
});
