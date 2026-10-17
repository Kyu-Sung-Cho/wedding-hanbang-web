import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
vi.mock("@/lib/demoSession", () => ({ hasSignedDemoSessionFromCookieHeader: () => false }));
vi.mock("@/lib/utils/vendorMapper", () => ({ bookingRowToBooking: (row: { id: string }) => ({ id: row.id }) }));
import { GET } from "./route";
const request = () => GET(new NextRequest("https://example.invalid/api/bookings/mine"));
function fixture(failure?: "profile" | "bookings" | "vendors", empty = false, noCouple = false) {
  const profile = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({
    data: noCouple ? { couple_id: null } : { couple_id: "couple-1" },
    error: failure === "profile" ? { code: "SYNTHETIC" } : null,
  })) };
  profile.select.mockReturnValue(profile); profile.eq.mockReturnValue(profile);
  const bookings = { select: vi.fn(), eq: vi.fn(), order: vi.fn(async () => ({
    data: empty ? [] : [{ id: "booking-1", vendor_id: "vendor-1" }],
    error: failure === "bookings" ? { code: "SYNTHETIC" } : null,
  })) };
  bookings.select.mockReturnValue(bookings); bookings.eq.mockReturnValue(bookings);
  mocks.server.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-user" } } }) },
    from: (table: string) => table === "profiles" ? profile : bookings,
  });
  const vendors = { select: vi.fn(), in: vi.fn(), eq: vi.fn(async () => ({
    data: [{ id: "vendor-1", name: "가상 업체" }],
    error: failure === "vendors" ? { code: "SYNTHETIC" } : null,
  })) };
  vendors.select.mockReturnValue(vendors); vendors.in.mockReturnValue(vendors);
  mocks.admin.mockReturnValue({ from: () => vendors });
}
describe("내 예약 조회의 오류/빈 목록 구분", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each(["profile", "bookings", "vendors"] as const)("%s 조회 실패를 5xx로 전달한다", async (failure) => {
    fixture(failure);
    const response = await request();
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.json()).not.toHaveProperty("bookings");
  });
  it("정상 0건만 빈 목록으로 응답한다", async () => {
    fixture(undefined, true);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bookings: [] });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("정상 조회된 미연결 프로필은 기존 빈 목록 계약을 유지한다", async () => {
    fixture(undefined, false, true);
    expect(await (await request()).json()).toEqual({ bookings: [] });
  });
  it("정상 예약·업체명 조회를 유지한다", async () => {
    fixture();
    expect(await (await request()).json()).toEqual({ bookings: [{ id: "booking-1", vendorName: "가상 업체" }] });
  });
  it.each(["profile", "bookings", "vendors"] as const)("%s 일시 장애 뒤 재요청하면 정상 목록으로 복구한다", async (failure) => {
    fixture(failure);
    expect((await request()).status).toBe(500);
    fixture();
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).bookings).toHaveLength(1);
  });
});
