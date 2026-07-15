import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("/api/messages/threads GET", () => {
  it("returns a request-independent retirement response", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "업체 연결 메시지함은 현재 제공하지 않습니다.",
      code: "vendor_messages_disabled",
    });
  });
});
