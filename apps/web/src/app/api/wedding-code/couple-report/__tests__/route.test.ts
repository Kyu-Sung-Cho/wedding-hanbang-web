import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("/api/wedding-code/couple-report GET", () => {
  it("is code-hard-disabled before reading a query token", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: "커플 비교 기능을 안전 점검 중입니다.",
      status: "disabled",
    });
  });
});
