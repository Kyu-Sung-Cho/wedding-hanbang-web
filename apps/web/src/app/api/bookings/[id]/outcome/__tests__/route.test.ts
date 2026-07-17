import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { processBookingProjectionJob } from "@/lib/bookings/projectionOutbox";
import { recordDecision } from "@/lib/memory/record-decision";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: vi.fn(() => Promise.resolve({ nodeId: "decision-1" })),
}));

vi.mock("@/lib/bookings/projectionOutbox", () => ({
  processBookingProjectionJob: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "booking:outcome:user-1"),
}));

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

function mockAuthClient(userId = "user-1") {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockAdminClient(rpcResult: QueryResult = { data: {}, error: null }) {
  const admin = {
    from: vi.fn(),
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

function atomicRpcResult({
  actualAmount = 3000000,
  contractedAmount = 2500000,
  rating = 4,
  content = null as string | null,
  isVisible = false,
} = {}): QueryResult {
  return {
    data: {
      accepted: true,
      coupleId: "42345678-1234-4234-9234-123456789abc",
      booking: {
        id: "12345678-1234-4234-9234-123456789abc",
        status: "completed",
        amount: 2500000,
        contractedAmount,
        actualAmount,
      },
      review: {
        id: "52345678-1234-4234-9234-123456789abc",
        rating,
        content,
        isVisible,
      },
      decisionId: "62345678-1234-4234-9234-123456789abc",
      baselineAmount: contractedAmount ?? 2500000,
      extraAmount: Math.max(0, actualAmount - (contractedAmount ?? 2500000)),
      context: {
        vendorId: "22345678-1234-4234-9234-123456789abc",
        vendorName: "테스트 스튜디오",
        vendorCategory: "studio",
        productId: "32345678-1234-4234-9234-123456789abc",
        productName: "기본 촬영",
      },
    },
    error: null,
  };
}

describe("/api/bookings/[id]/outcome PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthClient();
  });

  it("stores actual amount, private review, and completed decision for an owned booking", async () => {
    const admin = mockAdminClient(
      atomicRpcResult({ content: "상담은 좋았고 원본 추가금이 있었어요." }),
    );
    vi.mocked(processBookingProjectionJob).mockResolvedValue({
      bookingId: "12345678-1234-4234-9234-123456789abc",
      desiredState: "active",
      status: "completed",
      retryable: false,
      attemptCount: 1,
      sync: {
        persisted: true,
        projectionDisposition: "completed",
        nextProgress: {},
        scheduleAdded: false,
        scheduleUpdated: true,
        budgetUpdated: true,
        budgetExceededBy: 0,
        categoryBudgetLimit: 3500000,
        categoryLabel: "스튜디오",
        syncedEvent: {
          id: "evt_booking_12345678-1234-4234-9234-123456789abc",
          sourceKey: "booking:12345678-1234-4234-9234-123456789abc",
          date: "2026-07-01",
          title: "테스트 스튜디오 상담",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        syncedCategoryKey: "studio",
        syncedNewSpent: 3000000,
      },
    });

    const response = await PATCH(
      createOutcomeRequest({
        actualAmount: 3000000,
        contractedAmount: 2500000,
        rating: 4,
        review: "상담은 좋았고 원본 추가금이 있었어요.",
        sharePublicReview: false,
      }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      booking: {
        id: "12345678-1234-4234-9234-123456789abc",
        actual_amount: 3000000,
      },
      review: {
        rating: 4,
        is_visible: false,
      },
    });
    expect(body.outcome.extraAmount).toBe(500000);
    expect(body.outcome.budgetSync).toMatchObject({
      persisted: true,
      budgetUpdated: true,
      categoryKey: "studio",
      categorySpent: 3000000,
    });
    expect(processBookingProjectionJob).toHaveBeenCalledWith(admin, {
      bookingId: "12345678-1234-4234-9234-123456789abc",
    });
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("returns 202 without hiding a durably queued actual-amount projection", async () => {
    mockAdminClient(atomicRpcResult());
    vi.mocked(processBookingProjectionJob).mockResolvedValue({
      bookingId: "12345678-1234-4234-9234-123456789abc",
      desiredState: "active",
      status: "pending_retry",
      retryable: true,
      attemptCount: 1,
      retryAfterSeconds: 5,
      errorCode: "PROJECTION_APPLY_FAILED",
    });

    const response = await PATCH(
      createOutcomeRequest({
        actualAmount: 3000000,
        contractedAmount: 2500000,
        rating: 4,
      }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      outcomeAccepted: true,
      fullyApplied: false,
      projection: {
        status: "pending_retry",
        retryable: true,
        attemptCount: 1,
        retryAfterSeconds: 5,
        errorCode: "PROJECTION_APPLY_FAILED",
      },
      outcome: {
        budgetSync: { persisted: false },
      },
    });
    expect(body.message).toContain("결과를 다시 입력할 필요는 없습니다");
  });

  it("commits the canonical outcome through one atomic service RPC", async () => {
    const admin = mockAdminClient(atomicRpcResult({ content: "좋았어요." }));
    vi.mocked(processBookingProjectionJob).mockResolvedValue({
      bookingId: "12345678-1234-4234-9234-123456789abc",
      desiredState: "active",
      status: "completed",
      retryable: false,
      attemptCount: 1,
    });

    const response = await PATCH(
      createOutcomeRequest({
        actualAmount: 3000000,
        contractedAmount: 2500000,
        rating: 4,
        review: "좋았어요.",
        sharePublicReview: false,
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("complete_vendor_booking_outcome", {
      p_booking_id: "12345678-1234-4234-9234-123456789abc",
      p_customer_id: "user-1",
      p_actual_amount: 3000000,
      p_contracted_amount: 2500000,
      p_rating: 4,
      p_review: "좋았어요.",
      p_share_public_review: false,
    });
    expect(admin.from).not.toHaveBeenCalledWith("vendor_reviews");
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("does not update another couple's booking", async () => {
    const admin = mockAdminClient({
      data: null,
      error: { message: "booking_outcome_not_found" },
    });

    const response = await PATCH(
      createOutcomeRequest({ actualAmount: 2500000, rating: 5 }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain("예약을 찾을 수 없습니다");
    expect(admin.from).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic RPC response cannot prove the committed identity", async () => {
    mockAdminClient({ data: { accepted: true }, error: null });

    const response = await PATCH(
      createOutcomeRequest({ actualAmount: 2500000, rating: 5 }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("같은 내용을 다시 저장해도 중복 처리되지 않습니다");
    expect(processBookingProjectionJob).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("rejects invalid amount or rating payloads", async () => {
    mockAdminClient();

    const response = await PATCH(
      createOutcomeRequest({ actualAmount: -1, rating: 9 }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("입력값");
  });
});
