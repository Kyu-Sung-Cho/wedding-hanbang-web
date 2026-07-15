import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("community poll writes", () => {
  it("retires voting before auth, params, body, or database access", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "새 투표와 투표 변경은 현재 제공하지 않습니다.",
      code: "community_poll_writes_retired",
    });
  });
});
