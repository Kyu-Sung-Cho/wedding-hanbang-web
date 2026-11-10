import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduleEvent } from "@/types/database.types";
import type { ToolExecutionContext } from "../toolTypes";
import {
  executeCancelBooking,
  executeCreateBooking,
  executeGetAvailableSlots,
  executeGetMyBookings,
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
    actorProfileId: "70000000-0000-4000-8000-000000000001",
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

  it("lists not-sent intents with immutable vendor and product snapshots", async () => {
    mockAdminClient({
      vendor_bookings: [{
        awaitResult: {
          data: [{
            id: "12345678-1234-4234-9234-123456789abc",
            vendor_id: "22345678-1234-4234-9234-123456789abc",
            product_id: "32345678-1234-4234-9234-123456789abc",
            staff_id: null,
            booking_date: "2099-07-20",
            booking_time: "10:00",
            status: "pending",
            amount: 500_000,
            memo: "",
            created_at: "2026-08-02T00:00:00.000Z",
            vendor_delivery_status: "not_sent",
            intent_vendor_name_snapshot: "Original Studio",
            intent_product_name_snapshot: "Original Package",
          }],
          error: null,
        },
      }],
      vendors: [{
        awaitResult: {
          data: [{ id: "22345678-1234-4234-9234-123456789abc", name: "Renamed Studio" }],
          error: null,
        },
      }],
      vendor_products: [{
        awaitResult: {
          data: [{ id: "32345678-1234-4234-9234-123456789abc", name: "Renamed Package" }],
          error: null,
        },
      }],
    });

    const result = await executeGetMyBookings({}, createContext());

    expect(result.success).toBe(true);
    expect(result.toolOutput.bookings).toEqual([
      expect.objectContaining({
        vendorName: "Original Studio",
        productName: "Original Package",
      }),
    ]);
    expect(result.displayMessage).toContain("Original Studio");
    expect(result.displayMessage).not.toContain("Renamed Studio");
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
      availabilityScope: string;
      vendorConfirmationRequired: boolean;
      candidateSource: string;
    };
    expect(output.candidateSource).toBe("staff");
    expect(output.availabilityScope).toBe("amora_internal_candidates");
    expect(output.vendorConfirmationRequired).toBe(true);
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
    expect(result.displayMessage).toContain("업체 확인이 필요해요");
    expect(result.toolOutput).not.toHaveProperty("_debug");
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
    const output = result.toolOutput as { resolvedTargetMonth: string | null };
    expect(output.resolvedTargetMonth).toBe("2026-08");
  });

  // The chat executor no longer reaches the two gates pinned by direct call in
  // this file (malformed create input here, the confirmed flag on cancel below):
  // it refuses a booking tool without a confirmed card, and with a card the
  // atomic path does not support booking tools. The booking writers are kept
  // for a later relaunch, so their own gates still need a test.
  it("rejects a malformed create_booking date and time before any database access", async () => {
    const result = await executeCreateBooking(
      { vendor_id: "v", date: "13일", time: "3시" },
      createContext(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_booking_input" },
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
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

    const admin = mockAdminClient(
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
              vendor_delivery_status: "not_sent",
              intent_created_by_profile_id: "70000000-0000-4000-8000-000000000001",
              intent_vendor_name_snapshot: "Hanbang Studio",
              intent_vendor_category_snapshot: "studio",
              intent_product_name_snapshot: "Basic",
            },
            error: null,
          },
        }],
        wedding_journeys: [{ singleResult: { data: { progress: initialProgress }, error: null } }],
      },
      {
        create_amora_booking_intent_atomic: () => ({ data: bookingId, error: null }),
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
              quotedAmount: 450_000,
              actualAmount: null,
              cancellation: null,
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
            __events: [event],
            __booking_costs: {
              [bookingId]: {
                amount: 0,
                categoryKey: "studio",
                basis: "none",
                quotedAmount: 450_000,
              },
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
              scheduleCancelled: false,
              recordedSpendPreserved: false,
              quoteContributionCorrected: false,
              quoteCorrectionAmount: 0,
              scheduleRemoved: false,
              budgetUpdated: false,
              budgetReverted: false,
              budgetDelta: 0,
              budgetExceededBy: 0,
              categoryBudgetLimit: 1_000_000,
              categoryKey: "studio",
              newSpent: null,
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
      internalRequestRecorded: true,
      vendorDeliveryStatus: "not_sent",
      vendorConfirmationStatus: "unconfirmed",
      quotedAmount: 450_000,
      amountBasis: "quote",
      status: "confirmed",
      scheduleAdded: true,
      budgetUpdated: false,
      syncedCategoryKey: null,
      syncedNewSpent: null,
    });
    expect(result.toolOutput.syncedEvent).toMatchObject({
      id: `evt_booking_${bookingId}`,
      date: "2026-07-06",
      categoryKey: "studio",
      sourceKey: `booking:${bookingId}`,
    });
    expect(progressPatch).toMatchObject({
      studio: { spent: 200_000 },
    });
    expect(result.toolOutput).not.toHaveProperty("amount");
    expect(result.displayMessage).toContain("견적");
    expect(result.displayMessage).toContain("결제 기록에는 더하지 않았어요");
    expect(result.displayMessage).toContain("아모라 안에 예약 요청을 기록했어요");
    expect(result.displayMessage).toContain("업체에 전달되거나 확정된 상태는 아니에요");
    const createdProgress = ctx.weddingContext.progress as unknown as Record<string, unknown>;
    const events = createdProgress.__events as ScheduleEvent[] | undefined;
    expect(events?.[0]).toMatchObject({ id: `evt_booking_${bookingId}` });
    expect(admin.rpc).toHaveBeenCalledWith(
      "create_amora_booking_intent_atomic",
      expect.any(Object),
    );
    expect(admin.from.mock.calls.map(([table]) => table)).not.toContain("vendors");
    expect(admin.from.mock.calls.map(([table]) => table)).not.toContain("vendor_products");
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
              vendor_delivery_status: "not_sent",
              intent_created_by_profile_id: "70000000-0000-4000-8000-000000000001",
              intent_vendor_name_snapshot: "Hanbang Studio",
              intent_vendor_category_snapshot: "studio",
              intent_product_name_snapshot: null,
            },
            error: null,
          },
        }],
      },
      {
        create_amora_booking_intent_atomic: () => ({ data: bookingId, error: null }),
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
              quotedAmount: 500_000,
              actualAmount: null,
              cancellation: null,
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
    expect(result.displayMessage).toContain("같은 기록을 다시 만들 필요는 없어요");
    expect(result.displayMessage).toContain("자동으로 다시 반영");
  });

  it("does not cancel until the input carries the confirmed flag", async () => {
    const result = await executeCancelBooking({ booking_id: "x" }, createContext());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { requires_confirmation: true, confirmation_field: "confirmed" },
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("does not cancel when the verified actor profile is missing", async () => {
    const result = await executeCancelBooking(
      {
        booking_id: "12345678-1234-4234-9234-123456789abc",
        confirmed: true,
      },
      createContext({ actorProfileId: undefined }),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "booking_actor_missing" },
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("soft-cancels the schedule and preserves recorded actual spend when a booking is cancelled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const initialProgress = {
      __booking_costs: {
        [bookingId]: {
          amount: 650_000,
          categoryKey: "studio",
          basis: "actual",
          quotedAmount: 500_000,
        },
      },
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
        cancel_booking_atomic: (args) => {
          expect(args).toMatchObject({
            p_booking_id: bookingId,
            p_actor_profile_id: "70000000-0000-4000-8000-000000000001",
          });
          return { data: {
            id: bookingId,
            vendor_id: "12345678-1234-4234-9234-123456789abd",
            product_id: "product-1",
            booking_date: "2026-07-06",
            booking_time: "10:00",
            status: "cancelled",
            amount: 500_000,
            actual_amount: 650_000,
            cancelled_at: "2026-08-02T12:30:00.000Z",
            cancelled_by_profile_id: "70000000-0000-4000-8000-000000000001",
            cancel_reason: "예약 취소",
            idempotent: false,
          },
          error: null };
        },
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
              quotedAmount: 500_000,
              actualAmount: 650_000,
              cancellation: {
                cancelledAt: "2026-08-02T12:30:00.000Z",
                cancelledByProfileId: "70000000-0000-4000-8000-000000000001",
                reason: "예약 취소",
              },
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
          const cancelledEvent = {
            ...initialProgress.__events[0],
            status: "cancelled",
            cancellation: {
              cancelledAt: "2026-08-02T12:30:00.000Z",
              cancelledByProfileId: "70000000-0000-4000-8000-000000000001",
              reason: "예약 취소",
            },
            updatedAt: "2026-08-02T12:30:00.000Z",
          };
          progressPatch = {
            ...initialProgress,
            __events: [cancelledEvent],
          };
          return {
            data: {
              accepted: true,
              status: "completed",
              progress: progressPatch,
              event: cancelledEvent,
              scheduleAdded: false,
              scheduleUpdated: false,
              scheduleCancelled: true,
              recordedSpendPreserved: true,
              quoteContributionCorrected: false,
              quoteCorrectionAmount: 0,
              scheduleRemoved: false,
              budgetUpdated: false,
              budgetReverted: false,
              budgetDelta: 0,
              budgetExceededBy: 0,
              categoryBudgetLimit: 1_000_000,
              categoryKey: "studio",
              newSpent: null,
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
      internalCancellationRecorded: true,
      vendorCancellationStatus: "unconfirmed",
      scheduleCancelled: true,
      recordedSpendPreserved: true,
      quoteContributionCorrected: false,
      refundStatus: "unknown",
      scheduleRemoved: false,
      budgetReverted: false,
      syncedEventId: `evt_booking_${bookingId}`,
      syncedEventIdRemoved: null,
      syncedCategoryKey: null,
      syncedNewSpent: null,
    });
    expect(progressPatch).toMatchObject({
      studio: { spent: 850_000 },
      __events: [expect.objectContaining({
        id: `evt_booking_${bookingId}`,
        status: "cancelled",
      })],
      __booking_costs: {
        [bookingId]: expect.objectContaining({ amount: 650_000, basis: "actual" }),
      },
    });
    expect(ctx.weddingContext.progress).toMatchObject({
      studio: { spent: 850_000 },
      __events: [expect.objectContaining({ status: "cancelled" })],
    });
    expect(result.displayMessage).toContain("환불 여부와 금액은 확인되지 않았어요");
    expect(result.displayMessage).toContain("아모라 안 예약 기록을 취소 상태로 표시했어요");
    expect(result.displayMessage).toContain("업체 취소는 전달되거나 확정되지 않았어요");
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
            actual_amount: null,
            cancelled_at: "2026-08-02T12:30:00.000Z",
            cancelled_by_profile_id: "70000000-0000-4000-8000-000000000001",
            cancel_reason: "예약 취소",
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
              quotedAmount: 500_000,
              actualAmount: null,
              cancellation: {
                cancelledAt: "2026-08-02T12:30:00.000Z",
                cancelledByProfileId: "70000000-0000-4000-8000-000000000001",
                reason: "예약 취소",
              },
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
    expect(result.displayMessage).toContain("같은 취소 표시를 다시 보낼 필요는 없어요");
    expect(result.displayMessage).toContain("자동으로 다시 반영");
    expect(result.displayMessage).toContain("환불 여부와 금액은 확인되지 않았어요");
    expect(result.displayMessage).toContain("업체 취소는 전달되거나 확정되지 않았어요");
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
            actual_amount: null,
            cancelled_at: "2026-08-02T12:30:00.000Z",
            cancelled_by_profile_id: "70000000-0000-4000-8000-000000000001",
            cancel_reason: "예약 취소",
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
              quotedAmount: 500_000,
              actualAmount: null,
              cancellation: {
                cancelledAt: "2026-08-02T12:30:00.000Z",
                cancelledByProfileId: "70000000-0000-4000-8000-000000000001",
                reason: "예약 취소",
              },
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
          const cancelledEvent = {
            ...initialProgress.__events[0],
            status: "cancelled",
            cancellation: {
              cancelledAt: "2026-08-02T12:30:00.000Z",
              cancelledByProfileId: "70000000-0000-4000-8000-000000000001",
              reason: "예약 취소",
            },
            updatedAt: "2026-08-02T12:30:00.000Z",
          };
          progressPatch = {
            studio: { ...initialProgress.studio, spent: 200_000 },
            __events: [cancelledEvent],
            __booking_costs: {
              [bookingId]: {
                amount: 0,
                categoryKey: "studio",
                basis: "none",
                quotedAmount: 500_000,
              },
            },
          };
          return {
            data: {
              accepted: true,
              status: "completed",
              progress: progressPatch,
              event: cancelledEvent,
              scheduleAdded: false,
              scheduleUpdated: false,
              scheduleCancelled: true,
              recordedSpendPreserved: false,
              quoteContributionCorrected: true,
              quoteCorrectionAmount: 500_000,
              scheduleRemoved: false,
              budgetUpdated: true,
              budgetReverted: false,
              budgetDelta: -500_000,
              budgetExceededBy: 0,
              categoryBudgetLimit: 1_000_000,
              categoryKey: "studio",
              newSpent: 200_000,
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
      scheduleCancelled: true,
      recordedSpendPreserved: false,
      quoteContributionCorrected: true,
      quoteCorrectionAmount: 500_000,
      scheduleRemoved: false,
      budgetReverted: false,
      syncedEventId: "evt_booking_12345678",
      syncedEventIdRemoved: null,
      syncedCategoryKey: "studio",
      syncedNewSpent: 200_000,
    });
    expect(progressPatch).toMatchObject({
      studio: { spent: 200_000 },
      __events: [expect.objectContaining({
        id: "evt_booking_12345678",
        status: "cancelled",
      })],
    });
  });
});
