import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("/api/amora/quote-check/[id]/public GET", () => {
  it("retires historical bearer-link reads before parameters or storage", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "이전 견적 체크 공개 링크는 더 이상 제공하지 않습니다.",
      code: "quote_check_public_read_retired",
    });
  });
});
