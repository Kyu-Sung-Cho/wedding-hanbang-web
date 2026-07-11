import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("/api/wedding-code/response POST", () => {
  it("is code-hard-disabled while local-only results remain available", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: "응답 수집은 중단되었습니다. 개인 결과는 이 기기에서만 계산됩니다.",
    });
  });
});
