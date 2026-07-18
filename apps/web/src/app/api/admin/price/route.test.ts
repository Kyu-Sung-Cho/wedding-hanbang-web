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

describe("GET /api/admin/price", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails closed before creating a service client for a non-admin", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await GET(new Request("https://hanbang.ai/api/admin/price"));

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("returns low-confidence pending evidence first without exposing raw source paths", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const range = vi.fn().mockResolvedValue({
      data: [{
        id: "00000000-0000-4000-8000-000000000001",
        category: "studio",
        item_name: "샘플 기본 촬영",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        vat_note: null,
        price_note: null,
        review_status: "pending",
        needs_review: true,
        validation_issue_codes: ["low_confidence", "price_source_quote_mismatch"],
        source_file: "서울/샘플 공시.xlsx",
        source_object_keys: ["a".repeat(64) + ".xlsx"],
        source_quote: "샘플 기본 촬영 100만원",
        confidence: 0.41,
        review_version: 7,
        edited_by_admin: false,
        created_at: "2026-07-18T00:00:00.000Z",
        updated_at: "2026-07-18T00:00:00.000Z",
        snapshot: { period_label: "2026Q3", source: "kca_tprice", published_at: null },
        vendor: { id: "vendor-id", name: "샘플 스튜디오", slug: "sample-studio", category: "studio", region_code: "seoul_etc", status: "pending" },
        agency: null,
        options: [],
        alias_proposals: [{
          id: "00000000-0000-4000-8000-000000000003",
          alias: "샘플의 옛 상호",
          status: "pending",
          reviewed_at: null,
          reviewer_id: "must-not-leak",
          vendor_id: "must-not-leak",
        }],
      }],
      error: null,
    });
    const query = {
      order: vi.fn(),
      eq: vi.fn(),
      range,
    };
    query.order.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const select = vi.fn(() => query);
    mocks.getServiceClient.mockReturnValue({ from: vi.fn(() => ({ select })) });

    const response = await GET(new Request("https://hanbang.ai/api/admin/price"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(query.order).toHaveBeenCalledWith("confidence", {
      ascending: true,
      nullsFirst: true,
    });
    expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(query.eq).toHaveBeenCalledWith("review_status", "pending");
    expect(range).toHaveBeenCalledWith(0, 100);
    expect(select).toHaveBeenCalledWith(expect.stringContaining(
      "review_status, needs_review, validation_issue_codes",
    ));
    expect(body.prices[0]).toMatchObject({
      review_version: 7,
      needs_review: true,
      validation_issue_codes: ["low_confidence", "price_source_quote_mismatch"],
      alias_proposals: [{
        id: "00000000-0000-4000-8000-000000000003",
        alias: "샘플의 옛 상호",
        status: "pending",
        reviewed_at: null,
      }],
    });
    expect(body.prices[0].source_file_label).toBe("샘플 공시.xlsx");
    expect(body.prices[0].source_count).toBe(1);
    expect(body.prices[0].vendor.status).toBe("pending");
    expect(JSON.stringify(body)).not.toContain("서울/샘플 공시.xlsx");
    expect(JSON.stringify(body)).not.toContain("a".repeat(64) + ".xlsx");
    expect(JSON.stringify(body)).not.toContain("reviewer_id");
    expect(JSON.stringify(body)).not.toContain("vendor_id");
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lists pending agency packages with an explicit entity kind and private source keys stripped", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const objectKey = "c".repeat(64) + ".pdf";
    const range = vi.fn().mockResolvedValue({
      data: [{
        id: "00000000-0000-4000-8000-000000000101",
        package_name: "샘플 스드메 패키지",
        category_scope: ["studio", "dress", "makeup"],
        price_min_krw: 3_000_000,
        price_max_krw: 4_000_000,
        vat_note: null,
        price_note: null,
        options: [],
        review_status: "pending",
        validation_issue_codes: ["source_quote_requires_visual_review"],
        source_file: "서울/샘플 패키지.pdf",
        source_object_keys: [objectKey],
        source_quote: "샘플 스드메 패키지 300만원부터",
        confidence: 0.52,
        review_version: 4,
        edited_by_admin: false,
        created_at: "2026-07-18T00:00:00.000Z",
        updated_at: "2026-07-18T00:00:00.000Z",
        snapshot: { period_label: "2026Q3", source: "kca_tprice" },
        agency: { id: "agency-id", name: "샘플 대행사", region_code: "seoul_etc" },
      }],
      error: null,
    });
    const query = { order: vi.fn(), eq: vi.fn(), range };
    query.order.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const select = vi.fn(() => query);
    const from = vi.fn(() => ({ select }));
    mocks.getServiceClient.mockReturnValue({ from });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price?kind=agency_package&status=pending",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("official_agency_packages");
    expect(select).toHaveBeenCalledWith(expect.stringContaining(
      "review_status, needs_review, validation_issue_codes",
    ));
    expect(body.packages[0]).toMatchObject({
      entity_kind: "agency_package",
      review_version: 4,
      package_name: "샘플 스드메 패키지",
      needs_review: true,
      validation_issue_codes: ["source_quote_requires_visual_review"],
      source_available: true,
      source_file_label: "샘플 패키지.pdf",
    });
    expect(body.filters.kind).toBe("agency_package");
    expect(range).toHaveBeenCalledWith(0, 100);
    expect(JSON.stringify(body)).not.toContain(objectKey);
    expect(JSON.stringify(body)).not.toContain("서울/샘플 패키지.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("walks 437 stable rows through bounded cursors without gaps or duplicates", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    const rows = Array.from({ length: 437 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      category: "studio",
      item_name: `row-${index.toString().padStart(3, "0")}`,
      review_status: "pending",
      needs_review: false,
      validation_issue_codes: [],
      source_file: null,
      source_object_keys: [],
      options: [],
      alias_proposals: [],
      confidence: 0.5,
      created_at: "2026-07-18T00:00:00.000Z",
    }));
    const ranges: Array<[number, number]> = [];
    const select = vi.fn(() => {
      const query = {
        order: vi.fn(),
        eq: vi.fn(),
        range: vi.fn((from: number, to: number) => {
          ranges.push([from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        }),
      };
      query.order.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      return query;
    });
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({ select })),
    });

    const visited: string[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL("https://hanbang.ai/api/admin/price");
      url.searchParams.set("limit", "73");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await GET(new Request(url));
      const body = await response.json();
      expect(response.status).toBe(200);
      visited.push(...body.prices.map((item: { id: string }) => item.id));
      cursor = body.next_cursor;
    } while (cursor);

    expect(visited).toEqual(rows.map(({ id }) => id));
    expect(new Set(visited).size).toBe(437);
    expect(ranges).toEqual([
      [0, 73],
      [73, 146],
      [146, 219],
      [219, 292],
      [292, 365],
      [365, 438],
    ]);
  });

  it("rejects malformed pagination before creating a service client", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price?cursor=v2%3A10",
    ));

    expect(response.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });
});
