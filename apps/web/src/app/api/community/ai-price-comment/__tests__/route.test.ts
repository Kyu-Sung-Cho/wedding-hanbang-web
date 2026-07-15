import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("POST /api/community/ai-price-comment", () => {
  it("retires the sessionless price judgment endpoint instead of returning a comparison", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "자동 가격 판정은 중단되었습니다. 계약서의 포함 항목과 추가 조건을 직접 확인해 주세요.",
    });
  });
});
