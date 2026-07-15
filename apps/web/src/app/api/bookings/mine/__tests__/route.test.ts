import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("/api/bookings/mine GET", () => {
  it("returns a request-independent retirement response", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "웨딩한방 예약 기능은 현재 제공하지 않습니다.",
      code: "booking_requests_retired",
    });
  });
});
