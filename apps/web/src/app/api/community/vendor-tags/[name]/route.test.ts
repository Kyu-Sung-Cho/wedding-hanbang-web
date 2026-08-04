// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const VIEWER_ID = "10000000-0000-4000-8000-000000000001";
const AUTHOR_ID = "20000000-0000-4000-8000-000000000002";
const POST_ID = "30000000-0000-4000-8000-000000000003";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET } from "./route";

function result<T>(data: T, error: unknown = null) {
  return { data, error };
}

function chain<T>(value: T) {
  const terminal = Promise.resolve(result(value));
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => result(value)),
    then: terminal.then.bind(terminal),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function harness(options: {
  blocked?: boolean;
  viewerPosts?: Array<Record<string, unknown>>;
} = {}) {
  const unsafePost = {
    id: POST_ID,
    author_id: AUTHOR_ID,
    title: "blocked vendor review title",
    content: "blocked vendor review body",
    visibility: "public",
    under_review: false,
    created_at: "2026-08-04T00:00:00.000Z",
  };
  const serviceRpc = vi.fn(async (name: string) => {
    if (name === "community_viewer_can_see") {
      return result(!(options.blocked ?? true));
    }
    throw new Error(`Unexpected service RPC: ${name}`);
  });
  const viewerRpc = vi.fn((name: string) => {
    throw new Error(`Unexpected viewer RPC: ${name}`);
  });
  const candidatePostsQuery = chain([unsafePost]);
  const viewerPostsQuery = chain(options.viewerPosts ?? []);
  const serviceFrom = vi.fn((table: string) => {
    if (table === "community_vendor_tags") return chain(null);
    if (table === "community_posts") {
      throw new Error("Community posts must not cross the service-role reader");
    }
    if (table === "vendors") return chain(null);
    if (table === "community_public_profiles") {
      return chain([
        {
          user_id: AUTHOR_ID,
          nickname: "blocked author",
          avatar_url: null,
          rank: "sprout",
        },
      ]);
    }
    if (table === "profiles") {
      return chain([{ id: AUTHOR_ID, role: "bride" }]);
    }
    throw new Error(`Unexpected service table: ${table}`);
  });
  let viewerPostReadCount = 0;
  const viewerFrom = vi.fn((table: string) => {
    if (table === "community_posts") {
      viewerPostReadCount += 1;
      return viewerPostReadCount === 1 ? candidatePostsQuery : viewerPostsQuery;
    }
    if (table === "community_public_profiles") return chain([]);
    throw new Error(`Unexpected viewer table: ${table}`);
  });
  const serviceClient = { from: serviceFrom, rpc: serviceRpc };
  const viewerClient = {
    auth: {
      getUser: vi.fn(async () => result({ user: { id: VIEWER_ID } })),
    },
    from: viewerFrom,
    rpc: viewerRpc,
  };
  mocks.createAdminClient.mockReturnValue(serviceClient);
  mocks.createClientFromRequest.mockResolvedValue(viewerClient);
  return { serviceRpc, viewerRpc, candidatePostsQuery, viewerPostsQuery };
}

describe("vendor tag detail viewer boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("withholds blocked author posts and keeps the signed-in response private", async () => {
    const { serviceRpc, viewerRpc } = harness();

    const response = await GET(
      new Request("http://localhost/api/community/vendor-tags/studio") as never,
      { params: Promise.resolve({ name: "studio" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    expect(body.posts).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("blocked vendor review body");
    expect(viewerRpc).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith("community_viewer_can_see", {
      p_viewer_user_id: VIEWER_ID,
      p_other_user_id: AUTHOR_ID,
    });
  });

  it("excludes under-review posts at both the candidate and viewer read boundaries", async () => {
    const reviewedPost = {
      id: POST_ID,
      author_id: AUTHOR_ID,
      title: "reviewed title",
      content: "under-review body must stay hidden",
      visibility: "public",
      under_review: true,
      created_at: "2026-08-04T00:00:00.000Z",
    };
    const { candidatePostsQuery, viewerPostsQuery } = harness({
      blocked: false,
      viewerPosts: [reviewedPost],
    });

    const response = await GET(
      new Request("http://localhost/api/community/vendor-tags/studio") as never,
      { params: Promise.resolve({ name: "studio" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.posts).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("under-review body must stay hidden");
    expect(candidatePostsQuery.eq).toHaveBeenCalledWith("under_review", false);
    expect(viewerPostsQuery.eq).toHaveBeenCalledWith("under_review", false);
  });

  it("keeps a non-blocked public post after the viewer-scoped final read", async () => {
    const visiblePost = {
      id: POST_ID,
      author_id: AUTHOR_ID,
      title: "visible vendor review",
      content: "visible review body",
      visibility: "public",
      under_review: false,
      created_at: "2026-08-04T00:00:00.000Z",
    };
    harness({ blocked: false, viewerPosts: [visiblePost] });

    const response = await GET(
      new Request("http://localhost/api/community/vendor-tags/studio") as never,
      { params: Promise.resolve({ name: "studio" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.posts).toEqual([
      expect.objectContaining({ id: POST_ID, title: "visible vendor review" }),
    ]);
  });
});
