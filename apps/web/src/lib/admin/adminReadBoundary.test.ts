import { describe, expect, it } from "vitest";

import { adminPaginationMetadata, parseAdminPagination } from "./adminReadBoundary";

describe("admin read pagination boundary", () => {
  it("uses bounded defaults", () => {
    expect(parseAdminPagination(new Request("https://example.test/admin"), {
      defaultLimit: 100,
      maxLimit: 200,
    })).toEqual({ page: 1, limit: 100, offset: 0 });
  });

  it("accepts a bounded page and limit", () => {
    expect(parseAdminPagination(new Request("https://example.test/admin?page=3&limit=50"), {
      defaultLimit: 100,
      maxLimit: 200,
    })).toEqual({ page: 3, limit: 50, offset: 100 });
  });

  it.each([
    "page=0",
    "page=-1",
    "page=101",
    "page=1.5",
    "limit=0",
    "limit=201",
    "limit=1e2",
  ])("rejects invalid or abusive pagination: %s", (query) => {
    expect(parseAdminPagination(new Request(`https://example.test/admin?${query}`), {
      defaultLimit: 100,
      maxLimit: 200,
    })).toBeNull();
  });

  it("reports whether the response is partial", () => {
    expect(adminPaginationMetadata({ page: 2, limit: 100, offset: 100 }, 100, 250))
      .toEqual({ page: 2, limit: 100, total: 250, truncated: true });
  });
});
