// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET } from "./route";

function result<T>(data: T, error: unknown = null) {
  return { data, error };
}

function harness(options: {
  user?: { id: string } | null;
  authError?: { message: string } | null;
} = {}) {
  const user = options.user === undefined ? { id: USER_ID } : options.user;
  const filters: Array<[string, unknown]> = [];
  const terminal = () => {
    const excludesReviewed = filters.some(
      ([column, value]) => column === "under_review" && value === false,
    );
    return result(
      excludesReviewed
        ? [{ tags: ["safe-tag"] }]
        : [{ tags: ["safe-tag"] }, { tags: ["review-only-tag"] }],
    );
  };
  const query = {
    select: vi.fn(),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    }),
    gte: vi.fn(),
    not: vi.fn(),
    then: (
      onFulfilled: (value: ReturnType<typeof terminal>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(terminal()).then(onFulfilled, onRejected),
  };
  query.select.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.not.mockReturnValue(query);

  const client = {
    auth: {
      getUser: vi.fn(async () => result({ user }, options.authError ?? null)),
    },
    from: vi.fn(() => query),
  };
  mocks.createClientFromRequest.mockResolvedValue(client);
}

describe("popular tag viewer boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not count tags from under-review posts", async () => {
    harness();

    const response = await GET(
      new Request("http://localhost/api/community/popular-tags") as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tags).toEqual([{ tag: "safe-tag", count: 1 }]);
    expect(JSON.stringify(body)).not.toContain("review-only-tag");
  });

  it("does not publicly cache a signed-in viewer's block-filtered aggregate", async () => {
    harness();

    const response = await GET(
      new Request("http://localhost/api/community/popular-tags") as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });

  it("uses the shared cache only after confirming an anonymous viewer", async () => {
    harness({ user: null });

    const response = await GET(
      new Request("http://localhost/api/community/popular-tags") as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=600",
    );
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });

  it("fails closed to private caching when viewer confirmation errors", async () => {
    harness({ user: null, authError: { message: "auth unavailable" } });

    const response = await GET(
      new Request("http://localhost/api/community/popular-tags") as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });
});
