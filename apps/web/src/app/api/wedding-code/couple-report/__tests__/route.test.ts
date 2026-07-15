import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("/api/wedding-code/couple-report GET", () => {
  it("is code-hard-disabled before reading a query token", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: "웨딩코드와 커플 비교는 현재 제공하지 않습니다.",
      status: "retired",
    });
  });
});
