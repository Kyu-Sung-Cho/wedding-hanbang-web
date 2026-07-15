import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("/api/wedding-code/pair POST", () => {
  it("is code-hard-disabled and never returns a capability", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: "웨딩코드와 커플 비교는 현재 제공하지 않습니다.",
      pairingStatus: "retired",
    });
    expect(JSON.stringify(body)).not.toMatch(/coupleToken|couple_token|response_id/i);
  });
});
