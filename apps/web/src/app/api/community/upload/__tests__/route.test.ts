import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("/api/community/upload POST", () => {
  it("returns a request-independent retirement response", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "커뮤니티 미디어는 안전한 보관·삭제 수명주기가 검증될 때까지 제공하지 않습니다.",
      code: "community_media_retired",
    });
  });
});
