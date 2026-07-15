import { describe, expect, it } from "vitest";
import { ADMIN_BOOKING_HISTORY_RETIRED, GET } from "../route";

describe("retired admin booking history route", () => {
  it("never exposes historical booking PII", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(body).toEqual({
      error: "과거 예약 개인정보 조회 화면은 종료되었습니다.",
      code: ADMIN_BOOKING_HISTORY_RETIRED,
    });
    expect(body).not.toHaveProperty("bookings");
  });
});
