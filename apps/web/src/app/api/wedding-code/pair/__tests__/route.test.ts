import { describe, expect, it } from "vitest";
import { POST } from "../route";

describe("/api/wedding-code/pair POST", () => {
  it("is code-hard-disabled and never returns a capability", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: "커플 비교 기능을 안전 점검 중입니다.",
      pairingStatus: "disabled",
    });
    expect(JSON.stringify(body)).not.toMatch(/coupleToken|couple_token|response_id/i);
  });
});
