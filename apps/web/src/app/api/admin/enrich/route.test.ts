import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET } from "./route";

type QueueRow = {
  id: string;
  name: string;
  slug: string | null;
  category: string;
  status: "pending" | "approved" | "rejected";
  region_code: string | null;
  enrichment_status: string;
  enriched_at: string | null;
  private: Array<{ enriched_by: string }>;
};

type CategoryCounts = Record<string, { done: number; total: number }>;

function createServiceClientMock({
  queueRows,
  legacyLimitedRows = queueRows.slice(0, 300),
  counts,
  responsePageCap,
}: {
  queueRows: QueueRow[];
  legacyLimitedRows?: QueueRow[];
  counts: CategoryCounts;
  responsePageCap?: number;
}) {
  const queueQueries: Array<{
    selection: string;
    filters: Array<[string, string | string[]]>;
    ranges: Array<[number, number]>;
  }> = [];

  const select = vi.fn((columns: string, options?: { count?: string; head?: boolean }) => {
    if (columns.includes("private:vendor_enrichment_private")) {
      const includeExactCount = options?.count === "exact";
      const state = {
        selection: columns,
        filters: [] as Array<[string, string | string[]]>,
        ranges: [] as Array<[number, number]>,
      };
      queueQueries.push(state);
      const query = {
        order: vi.fn().mockReturnThis(),
        eq: vi.fn((field: string, value: string) => {
          state.filters.push([field, value]);
          return query;
        }),
        in: vi.fn((field: string, values: string[]) => {
          state.filters.push([field, values]);
          return query;
        }),
        limit: vi.fn().mockResolvedValue({ data: legacyLimitedRows, error: null }),
        range: vi.fn((from: number, to: number) => {
          state.ranges.push([from, to]);
          let filtered = queueRows;
          for (const [field, value] of state.filters) {
            if (Array.isArray(value)) {
              filtered = filtered.filter((row) => value.includes(String(row[field as keyof QueueRow] ?? "")));
              continue;
            }
            if (field === "private.enriched_by") {
              filtered = filtered.filter((row) => row.private[0]?.enriched_by === value);
            } else {
              filtered = filtered.filter((row) => String(row[field as keyof QueueRow] ?? "") === value);
            }
          }
          const requestedSize = to - from + 1;
          const pageSize = Math.min(requestedSize, responsePageCap ?? requestedSize);
          return Promise.resolve({
            data: filtered.slice(from, from + pageSize),
            count: includeExactCount ? filtered.length : null,
            error: null,
          });
        }),
      };
      return query;
    }

    if (columns === "id" && options?.count === "exact" && options.head === true) {
      const filters: Record<string, string> = {};
      const countQuery = {
        eq: vi.fn((field: string, value: string) => {
          filters[field] = value;
          return countQuery;
        }),
        in: vi.fn((field: string, values: string[]) => {
          filters[field] = values.join(",");
          return countQuery;
        }),
        then: (
          resolve: (value: { count: number; data: null; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          const categoryCounts = counts[filters.category] ?? { done: 0, total: 0 };
          const count = filters.enrichment_status === "done"
            ? categoryCounts.done
            : categoryCounts.total;
          return Promise.resolve({ count, data: null, error: null }).then(resolve, reject);
        },
      };
      return countQuery;
    }

    throw new Error(`Unexpected select: ${columns}`);
  });
  const from = vi.fn(() => ({ select }));
  return { client: { from }, queueQueries };
}

function vendor(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: "vendor-id",
    name: "샘플 웨딩홀",
    slug: "sample-hall",
    category: "venue",
    status: "approved",
    region_code: "seoul_etc",
    enrichment_status: "in_progress",
    enriched_at: null,
    private: [{ enriched_by: "admin-id" }],
    ...overrides,
  };
}

describe("GET /api/admin/enrich", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns schema categories, exact progress, and only an assignment boolean", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const service = createServiceClientMock({
      queueRows: [vendor(), vendor({
        id: "unsupported-vendor",
        category: "florist",
      })],
      counts: {
        studio: { done: 0, total: 0 },
        dress: { done: 0, total: 0 },
        makeup: { done: 0, total: 0 },
        venue: { done: 1, total: 2 },
      },
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request("https://hanbang.ai/api/admin/enrich"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.vendors).toHaveLength(1);
    expect(body.vendors[0]).toMatchObject({
      category: "hall",
      assigned_to_me: true,
    });
    expect(body.progress.hall).toEqual({ done: 1, total: 2 });
    expect(JSON.stringify(body)).not.toContain("admin-id");
    expect(service.queueQueries[0]?.filters).toContainEqual([
      "category",
      ["studio", "dress", "makeup", "venue"],
    ]);
    expect(service.queueQueries[0]?.filters).toContainEqual([
      "status",
      ["pending", "approved"],
    ]);
  });

  it("excludes rejected vendor tombstones from the queue", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const service = createServiceClientMock({
      queueRows: [
        vendor({ id: "active-vendor", status: "pending" }),
        vendor({ id: "merged-tombstone", status: "rejected" }),
      ],
      counts: { venue: { done: 0, total: 1 } },
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request("https://hanbang.ai/api/admin/enrich"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.vendors.map((item: { id: string }) => item.id)).toEqual(["active-vendor"]);
    expect(body.progress.all).toEqual({ done: 0, total: 1 });
  });

  it("returns all 650 of my assignments even after 300 other vendors", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const others = Array.from({ length: 300 }, (_, index) => vendor({
      id: `other-${index.toString().padStart(3, "0")}`,
      name: `Other Vendor ${index}`,
      category: "studio",
      private: [{ enriched_by: "another-admin" }],
    }));
    const mine = Array.from({ length: 650 }, (_, index) => vendor({
      id: `mine-${index.toString().padStart(3, "0")}`,
      name: `My Vendor ${index}`,
      category: "studio",
    }));
    const service = createServiceClientMock({
      queueRows: [...others, ...mine],
      legacyLimitedRows: others,
      counts: { studio: { done: 0, total: 950 } },
      responsePageCap: 300,
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/enrich?mine=1&status=in_progress"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.vendors).toHaveLength(650);
    expect(body.vendors.at(-1)).toMatchObject({
      id: "mine-649",
      assigned_to_me: true,
    });
    expect(service.queueQueries).toHaveLength(3);
    expect(service.queueQueries[0]?.selection).toContain(
      "private:vendor_enrichment_private!inner(enriched_by)",
    );
    expect(service.queueQueries[0]?.filters).toContainEqual([
      "private.enriched_by",
      "admin-id",
    ]);
    expect(service.queueQueries.map(({ ranges }) => ranges[0])).toEqual([
      [0, 499],
      [300, 799],
      [600, 1_099],
    ]);
  });

  it("reports exact progress when a category has more than 1,000 vendors", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const service = createServiceClientMock({
      queueRows: [],
      counts: { studio: { done: 1_201, total: 1_501 } },
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request("https://hanbang.ai/api/admin/enrich"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.progress.studio).toEqual({ done: 1_201, total: 1_501 });
    expect(body.progress.all).toEqual({ done: 1_201, total: 1_501 });
  });

  it("fails closed instead of silently truncating a queue above 5,000 rows", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const service = createServiceClientMock({
      queueRows: Array.from({ length: 5_001 }, (_, index) => vendor({
        id: `vendor-${index.toString().padStart(4, "0")}`,
        name: `Vendor ${index}`,
        category: "studio",
      })),
      counts: { studio: { done: 0, total: 5_001 } },
    });
    mocks.getServiceClient.mockReturnValue(service.client);

    const response = await GET(new Request("https://hanbang.ai/api/admin/enrich"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("ENRICHMENT_QUEUE_SAFE_LIMIT_EXCEEDED");
  });
});
