import { describe, expect, it } from "vitest";

import { AdminNextResponse } from "../privateResponse";

describe("AdminNextResponse", () => {
  it("forces private no-store on success and error JSON responses", async () => {
    const success = AdminNextResponse.json({ ok: true });
    const failure = AdminNextResponse.json(
      { error: "generated fixture" },
      { status: 422, headers: { "Cache-Control": "public, max-age=3600" } },
    );

    expect(success.headers.get("Cache-Control")).toBe("private, no-store");
    expect(failure.headers.get("Cache-Control")).toBe("private, no-store");
    expect(failure.status).toBe(422);
    await expect(failure.json()).resolves.toEqual({ error: "generated fixture" });
  });
});

