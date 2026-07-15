import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("retired customer survey intake", () => {
  it("always returns the fixed 410 response", async () => {
    const response = POST();
    await expect(response.json()).resolves.toEqual({
      code: "CUSTOMER_SURVEY_INTAKE_CLOSED",
      error: "현재 설문 응답을 받지 않습니다.",
    });
    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });
});
