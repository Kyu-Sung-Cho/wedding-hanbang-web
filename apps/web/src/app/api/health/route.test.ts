// @vitest-environment node

import { describe, expect, it } from "vitest";

import { GET, HEAD } from "./route";

describe("/api/health", () => {
  it.each([GET, HEAD])("returns an empty, non-cacheable 204", async (handler) => {
    const response = handler();

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.text()).resolves.toBe("");
  });
});
