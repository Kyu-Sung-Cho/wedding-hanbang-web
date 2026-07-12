import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  from: vi.fn(),
  purgeExpired: vi.fn(),
  loadRegistrations: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET } from "../route";

describe("GET /api/admin/registrations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T15:30:00.000Z"));
    vi.clearAllMocks();

    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.purgeExpired.mockResolvedValue({ error: null });
    mocks.loadRegistrations.mockResolvedValue({ data: [], error: null });
    mocks.from
      .mockReturnValueOnce({
        delete: vi.fn(() => ({ lt: mocks.purgeExpired })),
      })
      .mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            not: vi.fn(() => ({
              gt: vi.fn(() => ({ order: mocks.loadRegistrations })),
            })),
          })),
        })),
      });
    mocks.getServiceClient.mockReturnValue({ from: mocks.from });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an exact zero-filled 14-day KST series using verified applications only", async () => {
    mocks.loadRegistrations.mockResolvedValueOnce({
      data: [
        { id: "today", created_at: "2026-07-12T15:01:00.000Z", email_verified_at: "verified" },
        { id: "yesterday", created_at: "2026-07-12T14:59:00.000Z", email_verified_at: "verified" },
        { id: "pending", created_at: "2026-07-12T15:02:00.000Z", email_verified_at: null },
        { id: "week-a", created_at: "2026-07-05T15:10:00.000Z", email_verified_at: "verified" },
        { id: "week-b", created_at: "2026-07-06T01:00:00.000Z", email_verified_at: "verified" },
        { id: "old", created_at: "2026-06-28T15:00:00.000Z", email_verified_at: "verified" },
        { id: "invalid", created_at: "not-a-date", email_verified_at: "verified" },
      ],
      error: null,
    });

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/admin/registrations")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(6);
    expect(body.submittedTotal).toBe(7);
    expect(body.pendingVerificationTotal).toBe(1);
    expect(body.dailyCounts).toEqual([
      { date: "2026-06-30", count: 0 },
      { date: "2026-07-01", count: 0 },
      { date: "2026-07-02", count: 0 },
      { date: "2026-07-03", count: 0 },
      { date: "2026-07-04", count: 0 },
      { date: "2026-07-05", count: 0 },
      { date: "2026-07-06", count: 2 },
      { date: "2026-07-07", count: 0 },
      { date: "2026-07-08", count: 0 },
      { date: "2026-07-09", count: 0 },
      { date: "2026-07-10", count: 0 },
      { date: "2026-07-11", count: 0 },
      { date: "2026-07-12", count: 1 },
      { date: "2026-07-13", count: 1 },
    ]);
  });
});
