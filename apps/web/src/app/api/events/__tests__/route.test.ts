import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("/api/events POST", () => {
  it("retires raw event collection before reading request data", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "고객 행동 원시 로그 수집은 현재 제공하지 않습니다.",
      code: "customer_event_collection_retired",
    });
  });
});
