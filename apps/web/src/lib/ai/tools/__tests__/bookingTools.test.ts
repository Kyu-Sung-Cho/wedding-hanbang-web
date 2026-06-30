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
      slots: Array<{ date: string; time: string; remaining: number }>;
      count: number;
      exactDateAvailable: boolean | null;
      _debug: { slotSource: string };
    };
    expect(output._debug.slotSource).toBe("staff");
    expect(output.exactDateAvailable).toBe(true);
    expect(output.count).toBe(1);
    expect(output.slots).toEqual([
      { date: "2026-07-06", time: "10:00", remaining: 2, dayLabel: expect.any(String), hour: 10 },
    ]);
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

  it("syncs successful booking creation into schedule events and category spent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T15:00:00.000Z"));

    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const initialProgress = {
      studio: { category: "studio", status: "in_progress", budget: 1_000_000, spent: 200_000 },
    };
    let progressPatch: Record<string, unknown> | null = null;

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
        wedding_journeys: [{ singleResult: { data: { progress: initialProgress }, error: null } }],
      },
      {
        create_booking_atomic: () => ({ data: bookingId, error: null }),
        apply_journey_progress_patch: (args) => {
          progressPatch = args.p_patch as Record<string, unknown>;
          return { data: null, error: null };
        },
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
      amount: 500_000,
      scheduleAdded: true,
      budgetUpdated: true,
      syncedCategoryKey: "studio",
      syncedNewSpent: 700_000,
    });
    expect(result.toolOutput.syncedEvent).toMatchObject({
      id: `evt_booking_${bookingId}`,
      date: "2026-07-06",
      categoryKey: "studio",
      sourceKey: `booking:${bookingId}`,
    });
    expect(progressPatch).toMatchObject({
      studio: { spent: 700_000 },
    });
    const createdProgress = ctx.weddingContext.progress as unknown as Record<string, unknown>;
    const events = createdProgress.__events as ScheduleEvent[] | undefined;
    expect(events?.[0]).toMatchObject({ id: `evt_booking_${bookingId}` });
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

    mockAdminClient(
      {
        vendor_bookings: [
          {
            singleResult: {
              data: {
                id: bookingId,
                vendor_id: "vendor-1",
                product_id: "product-1",
                booking_date: "2026-07-06",
                booking_time: "10:00",
                status: "pending",
                amount: 500_000,
              },
              error: null,
            },
          },
          { updateResult: { error: null } },
        ],
        vendors: [{ singleResult: { data: { name: "Hanbang Studio", category: "studio" }, error: null } }],
        vendor_products: [{ singleResult: { data: { name: "Basic" }, error: null } }],
        wedding_journeys: [{ singleResult: { data: { progress: initialProgress }, error: null } }],
      },
      {
        apply_journey_progress_patch: (args) => {
          progressPatch = args.p_patch as Record<string, unknown>;
          return { data: null, error: null };
        },
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

  it("reverts legacy short-id booking events when a booking is cancelled", async () => {
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

    mockAdminClient(
      {
        vendor_bookings: [
          {
            singleResult: {
              data: {
                id: bookingId,
                vendor_id: "vendor-1",
                product_id: "product-1",
                booking_date: "2026-07-06",
                booking_time: "10:00",
                status: "pending",
                amount: 500_000,
              },
              error: null,
            },
          },
          { updateResult: { error: null } },
        ],
        vendors: [{ singleResult: { data: { name: "Hanbang Studio", category: "studio" }, error: null } }],
        vendor_products: [{ singleResult: { data: { name: "Basic" }, error: null } }],
        wedding_journeys: [{ singleResult: { data: { progress: initialProgress }, error: null } }],
      },
      {
        apply_journey_progress_patch: (args) => {
          progressPatch = args.p_patch as Record<string, unknown>;
          return { data: null, error: null };
        },
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
