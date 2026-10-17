import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestClient: vi.fn(), adminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: mocks.requestClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.adminClient }));
vi.mock("@/lib/community/authorProfiles", () => ({
  getCommunityAuthorMap: async () => ({}),
  fallbackCommunityAuthor: (userId: string) => ({ user_id: userId, nickname: "QA 작성자" }),
}));

import { GET } from "./route";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
type Row = Record<string, string | number | boolean>;
type QueryResult = { data: Row[]; count: number; error: null };

// 호출 횟수만 검사하지 않고 실제 필터·정렬·페이지 절단을 응답에 적용한다.
class FixtureQuery implements PromiseLike<QueryResult> {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ field: string; ascending: boolean }> = [];
  private start = 0;
  private end = Number.MAX_SAFE_INTEGER;

  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }
  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]));
    return this;
  }
  gt(field: string, value: number) {
    this.filters.push((row) => typeof row[field] === "number" && row[field] > value);
    return this;
  }
  gte(field: string, value: string) {
    this.filters.push((row) => typeof row[field] === "string" && row[field] >= value);
    return this;
  }
  or(expression: string) {
    const groups = [...expression.matchAll(/and\(([^()]+)\)/g)].map((match) =>
      match[1].split(",").map((atom) => {
        const parsed = /^([a-z_]+)\.eq\.(.+)$/.exec(atom);
        if (!parsed) throw new Error(`Unsupported fixture filter: ${atom}`);
        const value = parsed[2] === "true" ? true : parsed[2] === "false" ? false : parsed[2];
        return { field: parsed[1], value };
      }));
    if (!groups.length) throw new Error("An OR fixture must contain supported conditions");
    this.filters.push((row) => groups.some((group) => group.every(({ field, value }) => row[field] === value)));
    return this;
  }
  order(field: string, options: { ascending: boolean }) {
    this.orders.push({ field, ascending: options.ascending });
    return this;
  }
  range(start: number, end: number) { this.start = start; this.end = end; return this; }
  then<TResult1 = QueryResult, TResult2 = never>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const filtered = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    const sorted = [...filtered].sort((left, right) => {
      for (const { field, ascending } of this.orders) {
        if (left[field] === right[field]) continue;
        return (left[field] < right[field] ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    });
    return Promise.resolve({ data: sorted.slice(this.start, this.end + 1), count: filtered.length, error: null })
      .then(fulfilled, rejected);
  }
}

const rows: Row[] = [
  { id: "own-draft", author_id: OWNER, visibility: "draft", under_review: false, hot_rank: 100 },
  { id: "own-review", author_id: OWNER, visibility: "public", under_review: true, hot_rank: 99 },
  { id: "other-draft", author_id: OTHER, visibility: "draft", under_review: false, hot_rank: 98 },
  { id: "other-review", author_id: OTHER, visibility: "members", under_review: true, hot_rank: 97 },
  { id: "member-post", author_id: OTHER, visibility: "members", under_review: false, hot_rank: 5 },
  { id: "public-post", author_id: OTHER, visibility: "public", under_review: false, hot_rank: 4 },
  { id: "own-public", author_id: OWNER, visibility: "public", under_review: false, hot_rank: 3 },
].map((row) => ({ ...row, upvote_count: row.hot_rank, ad_disclosure: "general", created_at: "2026-10-18T00:00:00Z" }));

function actorSession(actor: string | null, sourceRows = rows) {
  // 실제 RLS 계약을 모사해 다른 작성자의 초안을 먼저 차단한다.
  const readable = sourceRows.filter((row) =>
    row.author_id === actor || (row.under_review === false
      && (row.visibility === "public" || (Boolean(actor) && row.visibility === "members"))));
  mocks.requestClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: actor ? { id: actor } : null }, error: null }) },
    from: (table: string) => {
      if (table === "community_posts") return new FixtureQuery(readable);
      if (table === "community_bookmarks") return new FixtureQuery([
        ...["own-draft", "own-review", "public-post", "other-draft", "own-ad"]
          .map((postId) => ({ user_id: OWNER, post_id: postId })),
      ]);
      if (["community_votes", "community_polls"].includes(table)) return new FixtureQuery([]);
      throw new Error(`Unexpected fixture table: ${table}`);
    },
  });
}

async function feed(query: string) {
  const response = await GET(new NextRequest(`http://localhost/api/community/posts?${query}`));
  expect(response.status).toBe(200);
  const body: { posts: Array<{ id: string }>; total: number; hasMore: boolean } = await response.json();
  return { response, ...body };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("ranked feed publication boundary", () => {
  it("fills the hot page with published posts instead of the author's higher-ranked drafts or review items", async () => {
    actorSession(OWNER);
    const result = await feed("sort=hot&limit=2");
    expect(result.posts.map((post) => post.id)).toEqual(["member-post", "public-post"]);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const next = await feed("sort=hot&limit=2&page=2");
    expect(next.posts.map((post) => post.id)).toEqual(["own-public"]);
    expect(next.hasMore).toBe(false);
  });

  it.each(["hot", "top"])("also excludes the next actor's own drafts while retaining published member posts: %s", async (sort) => {
    actorSession(OTHER);
    const result = await feed(`sort=${sort}&period=all&limit=5`);
    expect(result.posts.map((post) => post.id)).toEqual(["member-post", "public-post", "own-public"]);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it.each(["hot", "top"])("keeps guests on public published posts without exposing member-only posts: %s", async (sort) => {
    actorSession(null);
    const result = await feed(`sort=${sort}&period=all&limit=5`);
    expect(result.posts.map((post) => post.id)).toEqual(["public-post", "own-public"]);
    expect(result.total).toBe(2);
  });

  it.each(["limit=5", "sort=invalid&limit=5"])("applies the same boundary to the default hot feed: %s", async (query) => {
    actorSession(OWNER);
    const result = await feed(query);
    expect(result.posts.map((post) => post.id)).toEqual(["member-post", "public-post", "own-public"]);
  });

  it("preserves the author's readable drafts in the general newest feed and my posts", async () => {
    actorSession(OWNER);
    const newest = await feed("sort=new&limit=20");
    expect(newest.posts.map((post) => post.id)).toEqual([
      "own-draft", "own-review", "member-post", "public-post", "own-public",
    ]);
    const mine = await feed("sort=my_posts&limit=20");
    expect(mine.posts.map((post) => post.id)).toEqual(["own-draft", "own-review", "own-public"]);
    expect(mine.total).toBe(3);
    expect(mine.response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("fills the helped-post ranking with published posts instead of higher-voted own drafts or review items", async () => {
    actorSession(OWNER);
    const result = await feed("sort=top&period=all&limit=2");
    expect(result.posts.map((post) => post.id)).toEqual(["member-post", "public-post"]);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    const next = await feed("sort=top&period=all&limit=2&page=2");
    expect(next.posts.map((post) => post.id)).toEqual(["own-public"]);
    expect(next.hasMore).toBe(false);
  });

  it("preserves readable private, reviewed and disclosed saved posts in the personal newest collection", async () => {
    actorSession(OWNER, [...rows, { ...rows[0], id: "own-ad", visibility: "public", ad_disclosure: "sponsored" }]);
    const result = await feed("sort=new&bookmarked=true&limit=100");
    expect(result.posts.map((post) => post.id)).toEqual(["own-draft", "own-review", "public-post", "own-ad"]);
    expect(result.total).toBe(4);
    expect(result.response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    actorSession(OTHER);
    const otherCollection = await feed("sort=new&bookmarked=true&limit=100");
    expect(otherCollection.posts).toEqual([]);
    expect(otherCollection.total).toBe(0);
  });
});
