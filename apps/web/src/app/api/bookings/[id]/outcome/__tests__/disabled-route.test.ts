import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  BOOKING_OUTCOMES_DISABLED_CODE,
  BOOKING_OUTCOMES_ENABLED,
  PATCH,
} from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: vi.fn(),
}));

vi.mock("@/lib/bookings/progressSync", () => ({
  syncBookingProgressAfterOutcome: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(),
}));

describe("/api/bookings/[id]/outcome PATCH hard-disable contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 before auth, body parsing, or result/review mutation", async () => {
    const json = vi.fn(() => Promise.resolve({
      actualAmount: 3_000_000,
      rating: 5,
      review: "예시 데이터에 작성된 공개 후기",
      sharePublicReview: true,
    }));

    const response = await PATCH(
      { json } as unknown as Request,
      { params: Promise.resolve({ id: "12345678-1234-4234-9234-123456789abc" }) },
    );
    const payload = await response.json();

    expect(BOOKING_OUTCOMES_ENABLED).toBe(false);
    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "과거·예시 요청은 조회 전용입니다. 결과 저장과 공개 후기는 현재 지원하지 않습니다.",
      code: BOOKING_OUTCOMES_DISABLED_CODE,
    });
    expect(BOOKING_OUTCOMES_DISABLED_CODE).toBe("booking_outcomes_disabled");
    expect(json).not.toHaveBeenCalled();
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
