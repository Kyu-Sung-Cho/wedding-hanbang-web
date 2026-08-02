import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  revalidatePath: vi.fn(),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.rateLimit,
  rateLimitKey: vi.fn((prefix: string) => `${prefix}:test`),
}));

import { GET, POST } from "./route";

type DbRow = Record<string, unknown>;

type QueryLog = {
  table: string;
  columns: string;
  options: { count?: string; head?: boolean } | undefined;
  orders: Array<[string, Record<string, unknown> | undefined]>;
  ranges: Array<[number, number]>;
};

function createServiceClient({
  snapshots = [],
  prices = [],
  packages = [],
  responsePageCap = 500,
  reportedCounts = {},
  rpcResult = { data: null, error: null },
}: {
  snapshots?: DbRow[];
  prices?: DbRow[];
  packages?: DbRow[];
  responsePageCap?: number;
  reportedCounts?: Partial<Record<string, number>>;
  rpcResult?: { data: unknown; error: unknown };
} = {}) {
  const rowsByTable: Record<string, DbRow[]> = {
    price_snapshots: snapshots,
    official_prices: prices,
    official_agency_packages: packages,
  };
  const queries: QueryLog[] = [];

  const from = vi.fn((table: string) => ({
    select: vi.fn((
      columns: string,
      options?: { count?: string; head?: boolean },
    ) => {
      const log: QueryLog = {
        table,
        columns,
        options,
        orders: [],
        ranges: [],
      };
      queries.push(log);
      const rows = rowsByTable[table] ?? [];
      const reportedCount = reportedCounts[table] ?? rows.length;
      const result = () => ({
        data: options?.head ? null : rows,
        count: options?.count === "exact" ? reportedCount : null,
        error: null,
      });
      const query = {
        order: vi.fn((
          field: string,
          orderOptions?: Record<string, unknown>,
        ) => {
          log.orders.push([field, orderOptions]);
          return query;
        }),
        range: vi.fn((fromIndex: number, toIndex: number) => {
          log.ranges.push([fromIndex, toIndex]);
          const requested = toIndex - fromIndex + 1;
          const size = Math.min(requested, responsePageCap);
          return Promise.resolve({
            data: rows.slice(fromIndex, fromIndex + size),
            count: options?.count === "exact" ? reportedCount : null,
            error: null,
          });
        }),
        then: (
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    }),
  }));
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { client: { from, rpc }, from, queries, rpc };
}

const SNAPSHOT_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "a0000000-0000-4000-8000-000000000001";

function snapshot(overrides: DbRow = {}): DbRow {
  return {
    id: SNAPSHOT_ID,
    period_label: "2026-Q3",
    source: "kca_tprice",
    is_current: false,
    published_at: "2026-07-01",
    ...overrides,
  };
}

function evidence(overrides: DbRow = {}): DbRow {
  return {
    id: crypto.randomUUID(),
    snapshot_id: SNAPSHOT_ID,
    review_status: "approved",
    needs_review: false,
    source_file: "C:\\private\\official-price.xlsx",
    source_quote: "비공개 원문 인용 가격 1,000,000원",
    source_object_keys: ["a".repeat(64) + ".xlsx"],
    confidence: 0.9,
    ...overrides,
  };
}

describe("/api/admin/price/snapshots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects both methods before creating a service client for a non-admin", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const getResponse = await GET(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
    ));
    const postResponse = await POST(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
      {
        method: "POST",
        body: JSON.stringify({
          snapshot_id: "10000000-0000-4000-8000-000000000001",
          action: "promote",
        }),
      },
    ));

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(getResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(postResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("returns exact safe counts and ready state without exposing evidence fields", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const service = createServiceClient({
      snapshots: [snapshot()],
      prices: [
        evidence(),
        evidence({
          review_status: "rejected",
          needs_review: true,
          source_file: null,
          source_quote: null,
          source_object_keys: [],
          confidence: null,
        }),
      ],
      packages: [evidence()],
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.snapshots).toEqual([{
      id: SNAPSHOT_ID,
      period_label: "2026-Q3",
      source: "kca_tprice",
      is_current: false,
      published_at: "2026-07-01",
      price_counts: {
        total: 2,
        review_status: { pending: 0, approved: 1, rejected: 1, unknown: 0 },
        needs_review: { yes: 1, no: 1 },
        provenance: { complete: 1, incomplete: 1 },
        publishable_count: 1,
      },
      package_counts: {
        total: 1,
        review_status: { pending: 0, approved: 1, rejected: 0, unknown: 0 },
        needs_review: { yes: 0, no: 1 },
        provenance: { complete: 1, incomplete: 0 },
        publishable_count: 1,
      },
      publishable_count: 2,
      readiness: true,
      blocking_reasons: [],
    }]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("C:\\private");
    expect(serialized).not.toContain("비공개 원문 인용");
    expect(serialized).not.toContain("a".repeat(64) + ".xlsx");
    expect(serialized).not.toContain(ACTOR_ID);

    const snapshotQuery = service.queries.find((query) =>
      query.table === "price_snapshots" && query.ranges.length > 0
    );
    expect(snapshotQuery?.orders).toEqual([
      ["source", { ascending: true }],
      ["published_at", { ascending: false, nullsFirst: false }],
      ["period_label", { ascending: false }],
      ["id", { ascending: true }],
    ]);
    expect(snapshotQuery?.ranges).toEqual([[0, 199]]);
  });

  it("paginates beyond the 1,000-row API default without truncating counts", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const prices = Array.from({ length: 1_201 }, (_, index) => evidence({
      id: `price-${index.toString().padStart(4, "0")}`,
    }));
    const service = createServiceClient({
      snapshots: [snapshot()],
      prices,
      responsePageCap: 300,
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshots[0].price_counts.total).toBe(1_201);
    expect(body.snapshots[0].publishable_count).toBe(1_201);
    const pricePages = service.queries
      .filter((query) => query.table === "official_prices")
      .flatMap((query) => query.ranges);
    expect(pricePages).toEqual([
      [0, 999],
      [300, 1_299],
      [600, 1_599],
      [900, 1_899],
      [1_200, 2_199],
    ]);
  });

  it.each([
    {
      name: "empty",
      prices: [],
      packages: [],
      reasons: [
        "검토된 가격 또는 패키지 항목이 없습니다.",
        "공개 가능한 승인 항목이 없습니다.",
      ],
    },
    {
      name: "rejected only",
      prices: [evidence({ review_status: "rejected" })],
      packages: [],
      reasons: ["모든 항목이 반려 상태라 공개 가능한 승인 항목이 없습니다."],
    },
    {
      name: "pending and incomplete approved",
      prices: [evidence({ review_status: "pending", needs_review: true })],
      packages: [evidence({ source_quote: "", confidence: null })],
      reasons: [
        "가격 검토 대기 항목이 1건 남아 있습니다.",
        "패키지 승인 항목 중 근거가 불완전한 항목이 1건 있습니다.",
        "공개 가능한 승인 항목이 없습니다.",
      ],
    },
  ])("returns deterministic Korean blockers for $name snapshots", async ({
    prices,
    packages,
    reasons,
  }) => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const service = createServiceClient({
      snapshots: [snapshot()],
      prices,
      packages,
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshots[0].readiness).toBe(false);
    expect(body.snapshots[0].blocking_reasons).toEqual(reasons);
  });

  it("fails closed instead of returning a truncated snapshot list", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const service = createServiceClient({
      snapshots: Array.from({ length: 201 }, (_, index) => snapshot({
        id: `10000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      })),
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("SNAPSHOT_SAFE_LIMIT_EXCEEDED");
    expect(service.from).toHaveBeenCalledTimes(1);
  });

  it("fails closed before paginating an unbounded evidence table", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const service = createServiceClient({
      snapshots: [snapshot()],
      reportedCounts: { official_prices: 25_001 },
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("SNAPSHOT_SAFE_LIMIT_EXCEEDED");
    const pricePages = service.queries
      .filter((query) => query.table === "official_prices")
      .flatMap((query) => query.ranges);
    expect(pricePages).toEqual([[0, 999]]);
  });

  it("promotes only through the actor-bound service RPC without trusting advisory reads", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const service = createServiceClient();
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await POST(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_id: SNAPSHOT_ID, action: "promote" }),
      },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({ promoted: true, snapshot_id: SNAPSHOT_ID });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/price", "layout");
    expect(service.rpc).toHaveBeenCalledWith("promote_price_snapshot", {
      p_snapshot_id: SNAPSHOT_ID,
      p_actor_id: ACTOR_ID,
    });
    expect(service.from).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(ACTOR_ID);
  });

  it.each([
    { snapshot_id: SNAPSHOT_ID, action: "demote" },
    { snapshot_id: SNAPSHOT_ID, action: "promote", force: true },
    { snapshot_id: "not-a-uuid", action: "promote" },
    { snapshot_id: SNAPSHOT_ID },
  ])("rejects malformed or arbitrary promotion input %#", async (input) => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });

    const response = await POST(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
      { method: "POST", body: JSON.stringify(input) },
    ));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("bounds declared and streamed request bodies before creating a service client", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const oversized = "x".repeat(2_049);

    const declared = await POST(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
      {
        method: "POST",
        headers: { "Content-Length": "2049" },
        body: "{}",
      },
    ));
    const streamed = await POST(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
      { method: "POST", body: oversized },
    ));

    expect(declared.status).toBe(413);
    expect(streamed.status).toBe(413);
    expect(declared.headers.get("cache-control")).toBe("private, no-store");
    expect(streamed.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it.each([
    {
      error: {
        code: "55000",
        message: "PRICE_SNAPSHOT_OFFICIAL_PRICES_NOT_READY",
        details: "C:\\private\\official.xlsx 비공개 원문",
      },
      status: 409,
      code: "SNAPSHOT_NOT_READY",
    },
    {
      error: { code: "40001", message: "PRICE_SNAPSHOT_SOURCE_CHANGED_RETRY" },
      status: 409,
      code: "SNAPSHOT_PROMOTION_CONFLICT",
    },
    {
      error: { code: "P0002", message: "PRICE_SNAPSHOT_NOT_FOUND" },
      status: 404,
      code: "SNAPSHOT_NOT_FOUND",
    },
    {
      error: { code: "42501", message: "PRICE_SNAPSHOT_ADMIN_REQUIRED" },
      status: 401,
      code: "ADMIN_REQUIRED",
    },
    {
      error: { code: "22023", message: "PRICE_SNAPSHOT_ID_REQUIRED" },
      status: 400,
      code: "INVALID_PROMOTION_REQUEST",
    },
    {
      error: {
        code: "XX000",
        message: "raw database failure C:\\private\\secret.xlsx",
        details: "비공개 원문 전체",
      },
      status: 500,
      code: "SNAPSHOT_PROMOTION_FAILED",
    },
  ])("maps RPC failures without leaking database details %#", async ({
    error,
    status,
    code,
  }) => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ACTOR_ID });
    const service = createServiceClient({ rpcResult: { data: null, error } });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await POST(new Request(
      "https://hanbang.ai/api/admin/price/snapshots",
      {
        method: "POST",
        body: JSON.stringify({ snapshot_id: SNAPSHOT_ID, action: "promote" }),
      },
    ));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.code).toBe(code);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("비공개 원문");
    expect(serialized).not.toContain("PRICE_SNAPSHOT_");
  });
});
