import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("/api/wedding-code/response POST", () => {
  it("is retired without accepting or persisting answers", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: "웨딩코드와 응답 수집은 현재 제공하지 않습니다.",
    });
  });
});
