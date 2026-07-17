import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("production write-fence probe", () => {
  it("is side-effect-free and reports that proxy interception did not occur", async () => {
    const response = await POST();

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "production_write_fence_not_active",
    });
  });
});
