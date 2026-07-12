import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface QueryResult {
  data: Array<Record<string, unknown>> | null;
  error: unknown;
  count: number | null;
}

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  from: vi.fn(),
  purgeExpired: vi.fn(),
  registrationPages: [] as QueryResult[],
  registrationQueries: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET } from "../route";

const SNAPSHOT_TIME = "2026-07-12T15:30:00.000Z";

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function registration(
  sequence: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: uuid(sequence),
    created_at: "2026-07-12T15:00:00.000Z",
    email_verified_at: "2026-07-12T15:05:00.000Z",
    ...overrides,
  };
}

function createRegistrationQuery(result: QueryResult) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "not", "gt", "lte", "or", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn().mockResolvedValue(result);
  mocks.registrationQueries.push(query);
  return query;
}

describe("GET /api/admin/registrations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SNAPSHOT_TIME));
    vi.clearAllMocks();
    mocks.registrationPages.length = 0;
    mocks.registrationQueries.length = 0;

    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.purgeExpired.mockResolvedValue({ error: null });
    mocks.registrationPages.push({ data: [], error: null, count: 0 });
    mocks.from.mockImplementation(() => {
      if (mocks.from.mock.calls.length === 1) {
        return {
          delete: vi.fn(() => ({ lt: mocks.purgeExpired })),
        };
      }
      return createRegistrationQuery(
        mocks.registrationPages.shift() ?? { data: [], error: null, count: 0 }
      );
    });
    mocks.getServiceClient.mockReturnValue({ from: mocks.from });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns an exact zero-filled 14-day KST series using every verified application", async () => {
    mocks.registrationPages[0] = {
      data: [
        registration(1, { created_at: "2026-07-12T15:01:00.000Z" }),
        registration(2, { created_at: "2026-07-12T14:59:00.000Z" }),
        registration(3, { created_at: "2026-07-12T15:02:00.000Z", email_verified_at: null }),
        registration(4, { created_at: "2026-07-05T15:10:00.000Z" }),
        registration(5, { created_at: "2026-07-06T01:00:00.000Z" }),
        registration(6, { created_at: "2026-06-28T15:00:00.000Z" }),
        registration(7, { created_at: "not-a-date" }),
      ],
      error: null,
      count: 7,
    };

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/admin/registrations")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
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

    const query = mocks.registrationQueries[0];
    expect(query.lte).toHaveBeenCalledWith("created_at", SNAPSHOT_TIME);
    expect(query.select).toHaveBeenCalledWith("*", { count: "exact" });
    expect(query.limit).toHaveBeenCalledWith(500);
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
  });

  it("uses exact counts and a strict composite keyset even when the server cap shortens a page", async () => {
    const firstPage = [registration(1_000), registration(999)];
    mocks.registrationPages[0] = { data: firstPage, error: null, count: 4 };
    mocks.registrationPages.push({
      data: [registration(998), registration(997)],
      error: null,
      count: 2,
    });

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/admin/registrations")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.registrations).toHaveLength(4);
    expect(new Set(body.registrations.map((row: { id: string }) => row.id)).size).toBe(4);
    expect(body.submittedTotal).toBe(4);
    expect(body.total).toBe(4);
    expect(mocks.registrationQueries).toHaveLength(2);
    expect(mocks.registrationQueries[0].or).not.toHaveBeenCalled();
    expect(mocks.registrationQueries[1].or).toHaveBeenCalledWith(
      `created_at.lt.2026-07-12T15:00:00.000Z,and(created_at.eq.2026-07-12T15:00:00.000Z,id.lt.${uuid(999)})`
    );
  });

  it("fails closed without logging raw database errors when a later page fails", async () => {
    const databaseError = { message: "sensitive database detail", payload: { email: "private@example.com" } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.registrationPages[0] = {
      data: Array.from({ length: 500 }, (_, index) => registration(1_000 - index)),
      error: null,
      count: 501,
    };
    mocks.registrationPages.push({ data: null, error: databaseError, count: null });

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/admin/registrations")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "사용자 연구 신청 정보를 불러올 수 없습니다.",
    });
    expect(consoleError).toHaveBeenCalledWith("ADMIN_REGISTRATIONS_QUERY_FAILED");
    expect(consoleError).not.toHaveBeenCalledWith(expect.anything(), databaseError);
  });

  it("rejects an unsafe database cursor instead of interpolating it into PostgREST grammar", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rows = Array.from({ length: 500 }, (_, index) => registration(1_000 - index));
    rows[499] = registration(501, { created_at: "2026-07-12),email.eq.private@example.com" });
    mocks.registrationPages[0] = { data: rows, error: null, count: 501 };

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/admin/registrations")
    );

    expect(response.status).toBe(503);
    expect(mocks.registrationQueries).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith("ADMIN_REGISTRATIONS_INVALID_CURSOR");
  });

  it("returns an explicit error instead of silently truncating at the response safety cap", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.registrationPages[0] = {
      data: Array.from({ length: 500 }, (_, index) => registration(1_000 - index)),
      error: null,
      count: 10_001,
    };

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/admin/registrations")
    );

    expect(response.status).toBe(503);
    expect(mocks.registrationQueries).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith("ADMIN_REGISTRATIONS_SAFE_CAP_EXCEEDED");
  });
});
