import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduleEvent } from "@/types/database.types";
import type { ToolExecutionContext } from "../toolTypes";
import {
  executeCancelBooking,
  executeCreateBooking,
  executeGetAvailableSlots,
} from "../bookingTools";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

type QueryResult = {
  data?: unknown;
  error?: { message?: string } | null;
  count?: number | null;
};

type TableHandler = {
  awaitResult?: QueryResult;
  singleResult?: QueryResult;
  maybeSingleResult?: QueryResult;
  updateResult?: QueryResult;
  onUpdate?: (payload: unknown) => void;
};

type RpcHandler = (args: Record<string, unknown>) => QueryResult | Promise<QueryResult>;

class FakeQuery {
  private operation: "read" | "update" = "read";

  constructor(private readonly handler: TableHandler) {}

  select() { return this; }
  eq() { return this; }
  in() { return this; }
  neq() { return this; }
  not() { return this; }
  order() { return this; }
  limit() { return this; }

  update(payload: unknown) {
    this.operation = "update";
    this.handler.onUpdate?.(payload);
    return this;
  }

  single(): Promise<QueryResult> {
    return Promise.resolve(this.handler.singleResult ?? { data: null, error: null });
  }

  maybeSingle(): Promise<QueryResult> {
    return Promise.resolve(
      this.handler.maybeSingleResult ?? this.handler.singleResult ?? { data: null, error: null }
    );
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const result = this.operation === "update"
      ? this.handler.updateResult
      : this.handler.awaitResult;
    return Promise.resolve(result ?? { data: [], error: null }).then(onfulfilled, onrejected);
  }
}

function createAdminMock(
  tableHandlers: Record<string, TableHandler[]>,
  rpcHandlers: Record<string, RpcHandler> = {}
) {
  return {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table]?.shift() ?? {};
      return new FakeQuery(handler);
    }),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      const handler = rpcHandlers[name];
      return Promise.resolve(handler ? handler(args) : { data: null, error: null });
    }),
  };
}

const createAdminClientMock = vi.mocked(createAdminClient);

function mockAdminClient(
  tableHandlers: Record<string, TableHandler[]>,
  rpcHandlers: Record<string, RpcHandler> = {}
) {
  const admin = createAdminMock(tableHandlers, rpcHandlers);
  createAdminClientMock.mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>
  );
  return admin;
}

function createContext(
  overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
  return {
    coupleId: "couple-1",
    currentUserText: "",
    weddingContext: {
      weddingDate: "2026-10-10",
      budget: 50_000_000,
      venue: null,
      progress: {},
    },
    ...overrides,
  };
}

describe("bookingTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects availability lookup when the product does not belong to the vendor", async () => {
    mockAdminClient({
      vendors: [{ singleResult: { data: { name: "Hanbang Studio" }, error: null } }],
      vendor_products: [{ maybeSingleResult: { data: null, error: null } }],
    });

    const result = await executeGetAvailableSlots({
      vendor_id: "vendor-1",
      product_id: "product-from-other-vendor",
    });

    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({
      error: "invalid_product_vendor",
      vendorId: "vendor-1",
      productId: "product-from-other-vendor",
    });
  });

  it("uses staff slots before product slots when both schedules exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    mockAdminClient({
      vendors: [{ singleResult: { data: { name: "Hanbang Studio" }, error: null } }],
      vendor_products: [{ maybeSingleResult: { data: { id: "product-1" }, error: null } }],
      vendor_staff: [{ maybeSingleResult: { data: { id: "staff-1" }, error: null } }],
      staff_timeslots: [
        { awaitResult: { count: 1, error: null } },
        {
          awaitResult: {
            data: [{ day: 0, hour: 10, available: true, max_bookings: 2 }],
            error: null,
          },
        },
      ],
      product_timeslots: [{ awaitResult: { count: 1, error: null } }],
      vendor_bookings: [{ awaitResult: { data: [], error: null } }],
    });

    const result = await executeGetAvailableSlots({
      vendor_id: "vendor-1",
      product_id: "product-1",
      staff_id: "staff-1",
      target_date: "2026-07-06",
    });

    expect(result.success).toBe(true);
    const output = result.toolOutput as {
      slots: Array<{ date: string; time: string; remaining: number; dateTimeLabel: string }>;
      count: number;
      exactDateAvailable: boolean | null;
      _debug: { slotSource: string };
    };
    expect(output._debug.slotSource).toBe("staff");
    expect(output.exactDateAvailable).toBe(true);
    expect(output.count).toBe(1);
    expect(output.slots).toEqual([
      {
        date: "2026-07-06",
        time: "10:00",
        dateTimeLabel: "2026-07-06 (월) 10:00",
        remaining: 2,
        dayLabel: expect.any(String),
        hour: 10,
      },
    ]);
    expect(result.displayMessage).toContain("2026-07-06 (월) 10:00");
  });

  it("remaps past target months into the next future matching month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    mockAdminClient({
      vendors: [{ singleResult: { data: { name: "Hanbang Studio" }, error: null } }],
      vendor_timeslots: [{
        awaitResult: {
          data: [{ day: 0, hour: 10, available: true, max_bookings: 1 }],
          error: null,
        },
      }],
      vendor_bookings: [{ awaitResult: { data: [], error: null } }],
    });

    const result = await executeGetAvailableSlots({
      vendor_id: "vendor-1",
      target_month: "2025-08",
    });

    expect(result.success).toBe(true);
    const output = result.toolOutput as { _debug: { targetMonthResolved: string | null } };
    expect(output._debug.targetMonthResolved).toBe("2026-08");
  });

  it("blocks create_booking when the user-requested date differs from tool input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));
    mockAdminClient({});

    const result = await executeCreateBooking(
      {
        vendor_id: "vendor-1",
        date: "2026-07-06",
        time: "10:00",
      },
      createContext({ currentUserText: "[date:2026-07-07] [time:10:00] 예약해줘" })
    );

    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({
      error: "requested_date_mismatch",
      requestedDate: "2026-07-07",
      attemptedDate: "2026-07-06",
    });
  });

  it("uses the persisted booking amount and status when an exact create retry reuses a row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const initialProgress = {
      studio: { category: "studio", status: "in_progress", budget: 1_000_000, spent: 200_000 },
    };
    let progressPatch: Record<string, unknown> | null = null;
    const projectionVendorId = "22345678-1234-4234-9234-123456789abc";
    const projectionCoupleId = "32345678-1234-4234-9234-123456789abc";
    const claimToken = "42345678-1234-4234-9234-123456789abc";

    mockAdminClient(
      {
        vendors: [
          { singleResult: { data: { name: "Hanbang Studio", category: "studio" }, error: null } },
          { singleResult: { data: { id: "vendor-1", name: "Hanbang Studio", category: "studio" }, error: null } },
        ],
        profiles: [{
          awaitResult: {
            data: [
              { name: "Bride", role: "bride", phone: "010-0000-0000" },
              { name: "Groom", role: "groom", phone: null },
            ],
            error: null,
          },
        }],
        vendor_products: [{
          maybeSingleResult: {
            data: { name: "Basic", price: 700_000, discount_price: 500_000, is_active: true },
            error: null,
          },
        }],
        vendor_bookings: [{
          singleResult: {
            data: {
              id: bookingId,
              amount: 450_000,
              status: "confirmed",
              product_id: "product-1",
              staff_id: null,
            },
            error: null,
          },
        }],
        wedding_journeys: [{ singleResult: { data: { progress: initialProgress }, error: null } }],
      },
      {
        create_booking_atomic: () => ({ data: bookingId, error: null }),
        claim_booking_projection_job: () => ({
          data: {
            bookingId,
            coupleId: projectionCoupleId,
            desiredState: "active",
            generation: 1,
            attemptCount: 1,
            claimToken,
            booking: {
              date: "2026-07-06",
              time: "10:00",
              amount: 450_000,
              status: "confirmed",
              vendorId: projectionVendorId,
              productId: null,
              staffId: null,
              vendorName: "Hanbang Studio",
              vendorCategory: "studio",
            },
          },
          error: null,
        }),
        apply_booking_progress_projection: (args) => {
          const event = args.p_event as ScheduleEvent;
          progressPatch = {
            ...initialProgress,
            studio: { ...initialProgress.studio, spent: 650_000 },
            __events: [event],
            __booking_costs: {
              [bookingId]: { amount: 450_000, categoryKey: "studio" },
            },
          };
          return {
            data: {
              accepted: true,
              status: "completed",
              progress: progressPatch,
              event,
              scheduleAdded: true,
              scheduleUpdated: false,
              scheduleRemoved: false,
              budgetUpdated: true,
              budgetReverted: false,
              budgetDelta: 450_000,
              budgetExceededBy: 0,
              categoryBudgetLimit: 1_000_000,
              categoryKey: "studio",
              newSpent: 650_000,
              revertedAmount: 0,
              removedEventId: null,
            },
            error: null,
          };
        },
        finish_booking_projection_job: () => ({
          data: { accepted: true, status: "completed" },
          error: null,
        }),
      }
    );

    const ctx = createContext({
      currentUserText: "[date:2026-07-06] [time:10:00] 예약해줘",
      weddingContext: {
        weddingDate: "2026-10-10",
        budget: 50_000_000,
        venue: null,
        progress: initialProgress as unknown as ToolExecutionContext["weddingContext"]["progress"],
      },
    });

    const result = await executeCreateBooking(
      {
        vendor_id: "vendor-1",
        product_id: "product-1",
        date: "2026-07-06",
        time: "10:00",
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      bookingId,
      amount: 450_000,
      status: "confirmed",
      scheduleAdded: true,
      budgetUpdated: true,
      syncedCategoryKey: "studio",
      syncedNewSpent: 650_000,
    });
    expect(result.toolOutput.syncedEvent).toMatchObject({
      id: `evt_booking_${bookingId}`,
      date: "2026-07-06",
      categoryKey: "studio",
      sourceKey: `booking:${bookingId}`,
    });
    expect(progressPatch).toMatchObject({
      studio: { spent: 650_000 },
    });
    const createdProgress = ctx.weddingContext.progress as unknown as Record<string, unknown>;
    const events = createdProgress.__events as ScheduleEvent[] | undefined;
    expect(events?.[0]).toMatchObject({ id: `evt_booking_${bookingId}` });
  });

  it("keeps the booking accepted but explicitly reports a queued projection failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const vendorId = "22345678-1234-4234-9234-123456789abc";
    const claimToken = "32345678-1234-4234-9234-123456789abc";
    mockAdminClient(
      {
        vendors: [
          { singleResult: { data: { name: "Hanbang Studio", category: "studio" }, error: null } },
          { singleResult: { data: { id: vendorId, name: "Hanbang Studio", category: "studio" }, error: null } },
        ],
        profiles: [{ awaitResult: { data: [], error: null } }],
        vendor_bookings: [{
          singleResult: {
            data: {
              id: bookingId,
              amount: 500_000,
              status: "pending",
              product_id: null,
              staff_id: null,
            },
            error: null,
          },
        }],
      },
      {
        create_booking_atomic: () => ({ data: bookingId, error: null }),
        claim_booking_projection_job: () => ({
          data: {
            bookingId,
            coupleId: "10000000-0000-4000-8000-000000000001",
            desiredState: "active",
            generation: 1,
            attemptCount: 1,
            claimToken,
            booking: {
              date: "2026-07-06",
              time: "10:00",
              amount: 500_000,
              status: "pending",
              vendorId,
              productId: null,
              staffId: null,
              vendorName: "Hanbang Studio",
              vendorCategory: "studio",
            },
          },
          error: null,
        }),
        apply_booking_progress_projection: () => ({
          data: null,
          error: { message: "atomic projection failed" },
        }),
        finish_booking_projection_job: () => ({
          data: {
            accepted: true,
            status: "pending",
            retryable: true,
            attemptCount: 1,
            retryAfterSeconds: 5,
          },
          error: null,
        }),
      },
    );

    const result = await executeCreateBooking(
      { vendor_id: vendorId, date: "2026-07-06", time: "10:00" },
      createContext({
        coupleId: "10000000-0000-4000-8000-000000000001",
        currentUserText: "[date:2026-07-06] [time:10:00] 예약해줘",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      bookingId,
      status: "pending",
      projectionStatus: "pending_retry",
      projectionRetryable: true,
      projectionErrorCode: "PROJECTION_APPLY_FAILED",
      fullyApplied: false,
    });
    expect(result.displayMessage).toContain("예약을 다시 만들 필요는 없어요");
    expect(result.displayMessage).toContain("자동으로 다시 반영");
  });

  it("reverts synced schedule and budget data when a booking is cancelled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const initialProgress = {
      __booking_costs: { [bookingId]: 650_000 },
      studio: { category: "studio", status: "in_progress", budget: 1_000_000, spent: 850_000 },
      __events: [{
        id: `evt_booking_${bookingId}`,
        date: "2026-07-06",
        title: "10:00 Hanbang Studio",
        categoryKey: "studio",
        sourceKey: `booking:${bookingId}`,
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      }],
    };
    let progressPatch: Record<string, unknown> | null = null;
    const projectionCoupleId = "22345678-1234-4234-9234-123456789abc";
    const claimToken = "32345678-1234-4234-9234-123456789abc";

    mockAdminClient(
      {
        vendors: [{ singleResult: { data: { name: "Hanbang Studio", category: "studio" }, error: null } }],
        vendor_products: [{ singleResult: { data: { name: "Basic" }, error: null } }],
        wedding_journeys: [{ singleResult: { data: { progress: initialProgress }, error: null } }],
      },
      {
        cancel_booking_atomic: () => ({
          data: {
            id: bookingId,
            vendor_id: "12345678-1234-4234-9234-123456789abd",
            product_id: "product-1",
            booking_date: "2026-07-06",
            booking_time: "10:00",
            status: "cancelled",
            amount: 500_000,
            idempotent: false,
          },
          error: null,
        }),
        claim_booking_projection_job: () => ({
          data: {
            bookingId,
            coupleId: projectionCoupleId,
            desiredState: "cancelled",
            generation: 2,
            attemptCount: 1,
            claimToken,
            booking: {
              date: "2026-07-06",
              time: "10:00",
              amount: 500_000,
              status: "cancelled",
              vendorId: "12345678-1234-4234-9234-123456789abd",
              productId: null,
              staffId: null,
              vendorName: "Hanbang Studio",
              vendorCategory: "studio",
            },
          },
          error: null,
        }),
        apply_booking_progress_projection: () => {
          progressPatch = {
            studio: { ...initialProgress.studio, spent: 200_000 },
            __events: [],
            __booking_costs: {},
          };
          return {
            data: {
              accepted: true,
              status: "completed",
              progress: progressPatch,
              event: null,
              scheduleAdded: false,
              scheduleUpdated: false,
              scheduleRemoved: true,
              budgetUpdated: false,
              budgetReverted: true,
              budgetDelta: -650_000,
              budgetExceededBy: 0,
              categoryBudgetLimit: 1_000_000,
              categoryKey: "studio",
              newSpent: 200_000,
              revertedAmount: 650_000,
              removedEventId: `evt_booking_${bookingId}`,
            },
            error: null,
          };
        },
        finish_booking_projection_job: () => ({
          data: { accepted: true, status: "completed" },
          error: null,
        }),
      }
    );

    const ctx = createContext({
      weddingContext: {
        weddingDate: "2026-10-10",
        budget: 50_000_000,
        venue: null,
        progress: initialProgress as unknown as ToolExecutionContext["weddingContext"]["progress"],
      },
    });

    const result = await executeCancelBooking(
      { booking_id: bookingId, confirmed: true },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      bookingId,
      status: "cancelled",
      scheduleRemoved: true,
      budgetReverted: true,
      syncedEventIdRemoved: `evt_booking_${bookingId}`,
      syncedCategoryKey: "studio",
      syncedNewSpent: 200_000,
    });
    expect(progressPatch).toMatchObject({
      studio: { spent: 200_000 },
      __events: [],
      __booking_costs: {},
    });
    expect(ctx.weddingContext.progress).toMatchObject({
      studio: { spent: 200_000 },
      __events: [],
      __booking_costs: {},
    });
  });

  it("explicitly reports a queued cancellation projection failure", async () => {
    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const vendorId = "22345678-1234-4234-9234-123456789abc";
    const coupleId = "32345678-1234-4234-9234-123456789abc";
    const claimToken = "42345678-1234-4234-9234-123456789abc";
    mockAdminClient(
      {
        vendors: [{
          singleResult: {
            data: { name: "Hanbang Studio", category: "studio" },
            error: null,
          },
        }],
      },
      {
        cancel_booking_atomic: () => ({
          data: {
            id: bookingId,
            vendor_id: vendorId,
            product_id: null,
            booking_date: "2026-07-06",
            booking_time: "10:00",
            status: "cancelled",
            amount: 500_000,
            idempotent: false,
          },
          error: null,
        }),
        claim_booking_projection_job: () => ({
          data: {
            bookingId,
            coupleId,
            desiredState: "cancelled",
            generation: 2,
            attemptCount: 1,
            claimToken,
            booking: {
              date: "2026-07-06",
              time: "10:00",
              amount: 500_000,
              status: "cancelled",
              vendorId,
              productId: null,
              staffId: null,
              vendorName: "Hanbang Studio",
              vendorCategory: "studio",
            },
          },
          error: null,
        }),
        apply_booking_progress_projection: () => ({
          data: null,
          error: { message: "atomic cancellation projection failed" },
        }),
        finish_booking_projection_job: () => ({
          data: {
            accepted: true,
            status: "pending",
            retryable: true,
            attemptCount: 1,
            retryAfterSeconds: 5,
          },
          error: null,
        }),
      },
    );

    const result = await executeCancelBooking(
      { booking_id: bookingId, confirmed: true },
      createContext({ coupleId }),
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      bookingId,
      status: "cancelled",
      projectionStatus: "pending_retry",
      projectionRetryable: true,
      projectionErrorCode: "PROJECTION_APPLY_FAILED",
      fullyApplied: false,
    });
    expect(result.displayMessage).toContain("취소 요청을 다시 보낼 필요는 없어요");
    expect(result.displayMessage).toContain("자동으로 다시 반영");
  });

  it("repairs legacy progress on an exact retry of an already-cancelled booking", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const initialProgress = {
      studio: { category: "studio", status: "in_progress", budget: 1_000_000, spent: 700_000 },
      __events: [{
        id: "evt_booking_12345678",
        date: "2026-07-06",
        title: "10:00 Hanbang Studio",
        categoryKey: "studio",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      }],
    };
    let progressPatch: Record<string, unknown> | null = null;
    const projectionCoupleId = "22345678-1234-4234-9234-123456789abc";
    const claimToken = "32345678-1234-4234-9234-123456789abc";

    mockAdminClient(
      {
        vendors: [{ singleResult: { data: { name: "Hanbang Studio", category: "studio" }, error: null } }],
        vendor_products: [{ singleResult: { data: { name: "Basic" }, error: null } }],
        wedding_journeys: [{ singleResult: { data: { progress: initialProgress }, error: null } }],
      },
      {
        cancel_booking_atomic: () => ({
          data: {
            id: bookingId,
            vendor_id: "12345678-1234-4234-9234-123456789abd",
            product_id: "product-1",
            booking_date: "2026-07-06",
            booking_time: "10:00",
            status: "cancelled",
            amount: 500_000,
            idempotent: true,
          },
          error: null,
        }),
        claim_booking_projection_job: () => ({
          data: {
            bookingId,
            coupleId: projectionCoupleId,
            desiredState: "cancelled",
            generation: 2,
            attemptCount: 1,
            claimToken,
            booking: {
              date: "2026-07-06",
              time: "10:00",
              amount: 500_000,
              status: "cancelled",
              vendorId: "12345678-1234-4234-9234-123456789abd",
              productId: null,
              staffId: null,
              vendorName: "Hanbang Studio",
              vendorCategory: "studio",
            },
          },
          error: null,
        }),
        apply_booking_progress_projection: () => {
          progressPatch = {
            studio: { ...initialProgress.studio, spent: 200_000 },
            __events: [],
            __booking_costs: {},
          };
          return {
            data: {
              accepted: true,
              status: "completed",
              progress: progressPatch,
              event: null,
              scheduleAdded: false,
              scheduleUpdated: false,
              scheduleRemoved: true,
              budgetUpdated: false,
              budgetReverted: true,
              budgetDelta: -500_000,
              budgetExceededBy: 0,
              categoryBudgetLimit: 1_000_000,
              categoryKey: "studio",
              newSpent: 200_000,
              revertedAmount: 500_000,
              removedEventId: "evt_booking_12345678",
            },
            error: null,
          };
        },
        finish_booking_projection_job: () => ({
          data: { accepted: true, status: "completed" },
          error: null,
        }),
      }
    );

    const result = await executeCancelBooking(
      { booking_id: bookingId, confirmed: true },
      createContext({
        weddingContext: {
          weddingDate: "2026-10-10",
          budget: 50_000_000,
          venue: null,
          progress: initialProgress as unknown as ToolExecutionContext["weddingContext"]["progress"],
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      bookingId,
      status: "cancelled",
      idempotent: true,
      scheduleRemoved: true,
      budgetReverted: true,
      syncedEventIdRemoved: "evt_booking_12345678",
      syncedCategoryKey: "studio",
      syncedNewSpent: 200_000,
    });
    expect(progressPatch).toMatchObject({
      studio: { spent: 200_000 },
      __events: [],
    });
  });
});
