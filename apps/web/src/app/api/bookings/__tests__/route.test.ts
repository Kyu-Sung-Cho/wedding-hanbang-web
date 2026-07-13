import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  BOOKING_REQUESTS_DISABLED_CODE,
  BOOKING_REQUESTS_ENABLED,
  POST,
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
  syncBookingProgressAfterCreate: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(),
}));

describe("/api/bookings POST hard-disable contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 before auth, body parsing, or any PII storage path", async () => {
    const json = vi.fn(() => Promise.resolve({
      vendorId: "vendor-1",
      date: "2026-08-01",
      time: "11:00",
      memo: "민감한 상담 메모",
    }));

    const response = await POST({ json } as unknown as Request);
    const payload = await response.json();

    expect(BOOKING_REQUESTS_ENABLED).toBe(false);
    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "업체 연결 준비 중입니다. 현재 상담 요청은 업체에 전송되지 않으며 저장되지 않습니다.",
      code: BOOKING_REQUESTS_DISABLED_CODE,
    });
    expect(BOOKING_REQUESTS_DISABLED_CODE).toBe("booking_requests_disabled");
    expect(json).not.toHaveBeenCalled();
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
