import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { recordDecision } from "@/lib/memory/record-decision";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { patchBookingOutcome as PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: vi.fn(() => Promise.resolve({ nodeId: "decision-1" })),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  checkRateLimitPersistent: vi.fn(() => Promise.resolve(null)),
  rateLimitKey: vi.fn(() => "booking:outcome:user-1"),
}));

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableHandler = {
  maybeSingleResult?: QueryResult;
  singleResult?: QueryResult;
  updateResult?: QueryResult;
  insertResult?: QueryResult;
  onUpdate?: (payload: unknown) => void;
  onInsert?: (payload: unknown) => void;
  onEq?: (column: string, value: unknown) => void;
};

class FakeQuery {
  private operation: "read" | "update" | "insert" = "read";

  constructor(private readonly handler: TableHandler) {}

  select() { return this; }
  eq(column: string, value: unknown) {
    this.handler.onEq?.(column, value);
    return this;
  }

  update(payload: unknown) {
    this.operation = "update";
    this.handler.onUpdate?.(payload);
    return this;
  }

  insert(payload: unknown) {
    this.operation = "insert";
    this.handler.onInsert?.(payload);
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    if (this.operation === "update") {
      return Promise.resolve(this.handler.updateResult ?? { data: null, error: null });
    }
    if (this.operation === "insert") {
      return Promise.resolve(this.handler.insertResult ?? { data: null, error: null });
    }
    return Promise.resolve(this.handler.maybeSingleResult ?? { data: null, error: null });
  }

  single(): Promise<QueryResult> {
    if (this.operation === "update") {
      return Promise.resolve(this.handler.updateResult ?? { data: null, error: null });
    }
    if (this.operation === "insert") {
      return Promise.resolve(this.handler.insertResult ?? { data: null, error: null });
    }
    return Promise.resolve(this.handler.singleResult ?? { data: null, error: null });
  }
}

function mockAuthClient(userId = "user-1") {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockAdminClient(
  tableHandlers: Record<string, TableHandler[]>,
  rpcResult: QueryResult = { data: {}, error: null }
) {
  const admin = {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table]?.shift() ?? {};
      return new FakeQuery(handler);
    }),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>
  );
  return admin;
}

function createOutcomeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/bookings/12345678-1234-4234-9234-123456789abc/outcome", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id = "12345678-1234-4234-9234-123456789abc") {
  return { params: Promise.resolve({ id }) };
}

describe("/api/bookings/[id]/outcome PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthClient();
  });

  it("stores an outcome and public review without changing an owned terminal booking status", async () => {
    let bookingUpdate: unknown = null;
    let reviewInsert: unknown = null;
    const bookingUpdateFilters: Array<[string, unknown]> = [];

    const admin = mockAdminClient({
      profiles: [
        { singleResult: { data: { couple_id: "couple-1" }, error: null } },
      ],
      vendor_bookings: [
        {
          maybeSingleResult: {
            data: {
              id: "12345678-1234-4234-9234-123456789abc",
              couple_id: "couple-1",
              vendor_id: "22345678-1234-4234-9234-123456789abc",
              product_id: "32345678-1234-4234-9234-123456789abc",
              amount: 2500000,
              contracted_amount: null,
              actual_amount: null,
              status: "service_completed",
              vendor: { name: "테스트 스튜디오", category: "studio" },
              product: { name: "기본 촬영" },
            },
            error: null,
          },
        },
        {
          onUpdate: (payload) => { bookingUpdate = payload; },
          onEq: (column, value) => { bookingUpdateFilters.push([column, value]); },
          updateResult: {
            data: {
              id: "12345678-1234-4234-9234-123456789abc",
              status: "service_completed",
              amount: 2500000,
              contracted_amount: 2500000,
              actual_amount: 3000000,
            },
            error: null,
          },
        },
      ],
      wedding_journeys: [
        {
          singleResult: {
            data: {
              progress: {
                __events: [{
                  id: "evt_booking_12345678-1234-4234-9234-123456789abc",
                  date: "2026-07-01",
                  title: "테스트 스튜디오 상담",
                  sourceKey: "booking:12345678-1234-4234-9234-123456789abc",
                }],
                studio: {
                  label: "스튜디오",
                  budget: 3500000,
                  spent: 2500000,
                },
              },
            },
            error: null,
          },
        },
      ],
      vendor_reviews: [
        { maybeSingleResult: { data: null, error: null } },
        {
          onInsert: (payload) => { reviewInsert = payload; },
          insertResult: {
            data: {
              id: "review-1",
              rating: 4,
              content: "상담은 좋았고 원본 추가금이 있었어요.",
              is_visible: true,
            },
            error: null,
          },
        },
      ],
    });

    const response = await PATCH(
      createOutcomeRequest({
        actualAmount: 3000000,
        contractedAmount: 2500000,
        rating: 4,
        review: "상담은 좋았고 원본 추가금이 있었어요.",
        sharePublicReview: true,
      }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(bookingUpdate).toEqual({
      actual_amount: 3000000,
      contracted_amount: 2500000,
    });
    expect(bookingUpdateFilters).toContainEqual(["status", "service_completed"]);
    expect(body.booking.status).toBe("service_completed");
    expect(reviewInsert).toMatchObject({
      booking_id: "12345678-1234-4234-9234-123456789abc",
      customer_id: "user-1",
      rating: 4,
      is_visible: true,
    });
    expect(body.outcome.extraAmount).toBe(500000);
    expect(body.outcome.budgetSync).toMatchObject({
      persisted: true,
      budgetUpdated: true,
      budgetDelta: 500000,
      categoryKey: "studio",
      categorySpent: 3000000,
    });
    expect(admin.rpc).toHaveBeenCalledWith("apply_journey_progress_patch", {
      p_couple_id: "couple-1",
      p_patch: expect.objectContaining({
        studio: expect.objectContaining({ spent: 3000000 }),
        __booking_costs: expect.objectContaining({
          "12345678-1234-4234-9234-123456789abc": 3000000,
        }),
      }),
      p_remove_keys: [],
    });
    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        coupleId: "couple-1",
        decisionType: "completed",
        source: "vendor_booking",
        sourceRefId: "12345678-1234-4234-9234-123456789abc",
      })
    );
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "booking:outcome:user-1",
      { maxRequests: 20, windowMs: 60 * 60 * 1000 }
    );
  });

  it("rejects a pending consultation request without updating outcome or creating a public review", async () => {
    let bookingUpdate: unknown = null;
    let reviewInsert: unknown = null;
    const admin = mockAdminClient({
      profiles: [
        { singleResult: { data: { couple_id: "couple-1" }, error: null } },
      ],
      vendor_bookings: [
        {
          maybeSingleResult: {
            data: {
              id: "12345678-1234-4234-9234-123456789abc",
              couple_id: "couple-1",
              vendor_id: "22345678-1234-4234-9234-123456789abc",
              product_id: null,
              amount: 2500000,
              contracted_amount: null,
              actual_amount: null,
              status: "pending",
              vendor: { name: "테스트 스튜디오", category: "studio" },
              product: null,
            },
            error: null,
          },
        },
        {
          onUpdate: (payload) => { bookingUpdate = payload; },
          updateResult: {
            data: {
              id: "12345678-1234-4234-9234-123456789abc",
              status: "completed",
              amount: 2500000,
              contracted_amount: 2500000,
              actual_amount: 3000000,
            },
            error: null,
          },
        },
      ],
      vendor_reviews: [
        { maybeSingleResult: { data: null, error: null } },
        {
          onInsert: (payload) => { reviewInsert = payload; },
          insertResult: {
            data: {
              id: "review-1",
              rating: 5,
              content: "아직 상담 전인데 공개 후기",
              is_visible: true,
            },
            error: null,
          },
        },
      ],
      wedding_journeys: [
        {
          singleResult: {
            data: { progress: { studio: { label: "스튜디오", spent: 0 } } },
            error: null,
          },
        },
      ],
    });

    const response = await PATCH(
      createOutcomeRequest({
        actualAmount: 3000000,
        contractedAmount: 2500000,
        rating: 5,
        review: "아직 상담 전인데 공개 후기",
        sharePublicReview: true,
      }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("완료");
    expect(bookingUpdate).toBeNull();
    expect(reviewInsert).toBeNull();
    expect(admin.from).not.toHaveBeenCalledWith("vendor_reviews");
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("does not update another couple's booking", async () => {
    mockAdminClient({
      profiles: [
        { singleResult: { data: { couple_id: "couple-1" }, error: null } },
      ],
      vendor_bookings: [
        {
          maybeSingleResult: {
            data: {
              id: "12345678-1234-4234-9234-123456789abc",
              couple_id: "couple-2",
              vendor_id: "22345678-1234-4234-9234-123456789abc",
              product_id: null,
              amount: 2500000,
              contracted_amount: null,
              actual_amount: null,
              status: "confirmed",
              vendor: { name: "다른 업체", category: "dress" },
              product: null,
            },
            error: null,
          },
        },
      ],
    });

    const response = await PATCH(
      createOutcomeRequest({ actualAmount: 2500000, rating: 5 }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain("예약을 찾을 수 없습니다");
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("rejects invalid amount or rating payloads", async () => {
    mockAdminClient({});

    const response = await PATCH(
      createOutcomeRequest({ actualAmount: -1, rating: 9 }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("입력값");
  });
});
