// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainBookingProjectionJobs } from "@/lib/bookings/projectionOutbox";
import { GET } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/bookings/projectionOutbox", () => ({
  drainBookingProjectionJobs: vi.fn(),
}));

describe("/api/cron/booking-projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without the cron bearer token", async () => {
    const response = await GET(new NextRequest(
      "https://example.test/api/cron/booking-projections",
    ));

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("drains a bounded batch and reports queue health", async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          pending: 2,
          processing: 0,
          failed: 0,
          activeBacklog: 2,
          oldestActiveAgeSeconds: 12,
        },
        error: null,
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    vi.mocked(drainBookingProjectionJobs).mockResolvedValue({
      processed: 3,
      completed: 2,
      pendingRetry: 1,
      failed: 0,
      results: [],
    });

    const response = await GET(new NextRequest(
      "https://example.test/api/cron/booking-projections",
      { headers: { authorization: "Bearer test-cron-secret" } },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: 3,
      completed: 2,
      pendingRetry: 1,
      queue: { activeBacklog: 2, failed: 0 },
    });
    expect(drainBookingProjectionJobs).toHaveBeenCalledWith(admin, 40);
    expect(admin.rpc).toHaveBeenCalledWith("get_booking_projection_queue_stats");
  });

  it("fails the canary signal when terminal projection failures exist", async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          pending: 0,
          processing: 0,
          failed: 1,
          activeBacklog: 0,
          oldestActiveAgeSeconds: 0,
        },
        error: null,
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    vi.mocked(drainBookingProjectionJobs).mockResolvedValue({
      processed: 0,
      completed: 0,
      pendingRetry: 0,
      failed: 0,
      results: [],
    });

    const response = await GET(new NextRequest(
      "https://example.test/api/cron/booking-projections",
      { headers: { authorization: "Bearer test-cron-secret" } },
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      queue: { failed: 1 },
    });
  });
});
