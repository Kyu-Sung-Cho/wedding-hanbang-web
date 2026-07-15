import { describe, expect, it } from "vitest";

import { PATCH } from "../route";

describe("retired admin vendor mutation route", () => {
  it("always rejects legacy approval, rejection, and revocation requests", async () => {
    const response = PATCH();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      code: "VENDOR_ADMIN_MUTATION_RETIRED",
      error: "업체 승인·반려·승인 취소 기능은 현재 운영하지 않습니다.",
    });
  });
});
