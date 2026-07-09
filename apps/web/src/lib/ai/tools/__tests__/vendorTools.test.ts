import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  executeCheckVendorAvailability,
  executeGetVendorDetail,
  executeSearchVendors,
} from "../vendorTools";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

type QueryResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

type TableHandler = {
  awaitResult?: QueryResult;
  singleResult?: QueryResult;
  insertResult?: QueryResult;
  onInsert?: (payload: unknown) => void;
};

class FakeQuery {
  constructor(private readonly handler: TableHandler) {}

  select() { return this; }
  eq() { return this; }
  in() { return this; }
  neq() { return this; }
  limit() { return this; }
  order() { return this; }
  or() { return this; }
  lte() { return this; }
  gte() { return this; }

  single(): Promise<QueryResult> {
    return Promise.resolve(this.handler.singleResult ?? { data: null, error: null });
  }

  maybeSingle(): Promise<QueryResult> {
    return Promise.resolve(this.handler.singleResult ?? { data: null, error: null });
  }

  insert(payload: unknown): Promise<QueryResult> {
    this.handler.onInsert?.(payload);
    return Promise.resolve(this.handler.insertResult ?? { data: null, error: null });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.handler.awaitResult ?? { data: [], error: null }).then(onfulfilled, onrejected);
  }
}

function createAdminMock(tableHandlers: Record<string, TableHandler[]>) {
  return {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table]?.shift() ?? {};
      return new FakeQuery(handler);
    }),
  };
}

const createAdminClientMock = vi.mocked(createAdminClient);

function mockAdminClient(tableHandlers: Record<string, TableHandler[]>) {
  createAdminClientMock.mockReturnValue(
    createAdminMock(tableHandlers) as unknown as ReturnType<typeof createAdminClient>
  );
}

describe("vendorTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps get_vendor_detail not-found response", async () => {
    mockAdminClient({
      vendors: [{ singleResult: { data: null, error: null } }],
    });

    const result = await executeGetVendorDetail({ vendor_id: "missing-vendor" });

    expect(result).toMatchObject({
      toolName: "get_vendor_detail",
      toolOutput: {},
      success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    });
  });

  it("maps vendor products and staff into the existing detail shape", async () => {
    mockAdminClient({
      vendors: [{
        singleResult: {
          data: {
            id: "vendor-1",
            name: "한방스튜디오",
            category: "studio",
            location: "서울 강남",
            price_range: "150만원대",
          },
          error: null,
        },
      }],
      vendor_products: [{
        awaitResult: {
          data: [{
            id: "product-1",
            name: "본식 스냅",
            description: "본식 촬영 기본 구성입니다.",
            price: 1500000,
            discount_price: 1200000,
            duration_minutes: 180,
            is_popular: true,
            includes: ["원본", "보정본"],
          }],
          error: null,
        },
      }],
      vendor_staff: [{
        awaitResult: {
          data: [{
            id: "staff-1",
            name: "김작가",
            role: "photographer",
            description: "차분한 다큐 스타일 촬영",
          }],
          error: null,
        },
      }],
    });

    const result = await executeGetVendorDetail({ vendor_id: "vendor-1" });

    expect(result.toolName).toBe("get_vendor_detail");
    expect(result.success).toBe(true);
    expect(result.displayMessage).toBe("한방스튜디오의 상품 1개, 스태프 1명");
    expect(result.toolOutput).toMatchObject({
      vendorId: "vendor-1",
      vendorName: "한방스튜디오",
      category: "studio",
      location: "서울 강남",
      priceRange: "150만원대",
      products: [{
        id: "product-1",
        name: "본식 스냅",
        price: 1500000,
        discountPrice: 1200000,
        isPopular: true,
        includes: ["원본", "보정본"],
      }],
      staff: [{
        id: "staff-1",
        name: "김작가",
        role: "photographer",
      }],
    });
  });

  it("keeps search_vendors output shape and search log insert", async () => {
    const insertedLogs: unknown[] = [];
    mockAdminClient({
      vendors: [{
        awaitResult: {
          data: [{
            id: "vendor-1",
            name: "한방드레스",
            category: "dress",
            location: "서울",
            region: "강남",
            price_range: "200만원대",
            rating: 4.8,
            review_count: 17,
            tags: ["실크", "클래식"],
            ai_recommend: true,
          }],
          error: null,
        },
      }],
      profiles: [{ singleResult: { data: { id: "profile-1" }, error: null } }],
      search_logs: [{ onInsert: (payload) => insertedLogs.push(payload) }],
    });

    const result = await executeSearchVendors(
      { category: "드레스", search: "실크", limit: 5 },
      {
        coupleId: "couple-1",
        weddingContext: {
          budget: 50000000,
          progress: {},
        },
      }
    );

    expect(result.toolName).toBe("search_vendors");
    expect(result.success).toBe(true);
    expect(result.displayMessage).toBe("1개 업체를 찾았습니다: 한방드레스(200만원대)");
    expect(result.toolOutput).toMatchObject({
      count: 1,
      vendors: [{
        id: "vendor-1",
        name: "한방드레스",
        category: "dress",
        location: "서울",
        priceRange: "200만원대",
        rating: 4.8,
        reviewCount: 17,
        tags: ["실크", "클래식"],
        aiRecommend: true,
        link: "/wedding/vendors/vendor-1",
      }],
    });
    expect(insertedLogs).toEqual([{
      user_id: "profile-1",
      query: "실크",
      category: "드레스",
      result_count: 1,
    }]);
  });

  it("includes the concrete date and time in availability output", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T00:00:00.000Z"));

    mockAdminClient({
      vendors: [{ singleResult: { data: { name: "한방스튜디오" }, error: null } }],
      vendor_timeslots: [{
        awaitResult: {
          data: [{ day: 0, hour: 10, available: true, max_bookings: 2 }],
          error: null,
        },
      }],
      vendor_bookings: [{ awaitResult: { data: [], error: null } }],
    });

    const result = await executeCheckVendorAvailability({ vendor_id: "vendor-1" });

    expect(result.success).toBe(true);
    expect(result.displayMessage).toContain("2026-07-06 (월) 10:00");
    expect(result.toolOutput).toMatchObject({
      slots: [{
        date: "2026-07-06",
        time: "10:00",
        dateTimeLabel: "2026-07-06 (월) 10:00",
      }],
    });
  });
});
