// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  getCommunityAuthorMap: vi.fn(async () => ({})),
  fallbackCommunityAuthor: vi.fn((authorId: string) => ({
    user_id: authorId,
    nickname: "회원",
  })),
  canReadCommunityPost: vi.fn(() => true),
  checkCommunityWriteAccess: vi.fn(
    async (): Promise<
      | { allowed: true }
      | {
          allowed: false;
          status: 403 | 503;
          code: "COMMUNITY_SUSPENDED" | "COMMUNITY_WRITE_ACCESS_UNAVAILABLE";
          message: string;
        }
    > => ({ allowed: true }),
  ),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "comment-rate-key"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/community/authorProfiles", () => ({
  getCommunityAuthorMap: mocks.getCommunityAuthorMap,
  fallbackCommunityAuthor: mocks.fallbackCommunityAuthor,
}));
vi.mock("@/lib/community/publicPostRules", () => ({
  canReadCommunityPost: mocks.canReadCommunityPost,
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET, POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_POST_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";

function request(
  method: "GET" | "POST",
  body?: unknown,
  idempotencyKey: string | null = IDEMPOTENCY_KEY,
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  headers.set("origin", "http://localhost");
  headers.set("sec-fetch-site", "same-origin");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(
    `http://localhost/api/community/comments${method === "GET" ? `?postId=${POST_ID}` : ""}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function queryResult<T>(data: T, error: unknown = null) {
  return { data, error };
}

function invalidParentHarness(parent: {
  id?: string;
  post_id?: string;
  parent_id?: string | null;
  is_deleted?: boolean;
} | null) {
  const postMaybeSingle = vi.fn(async () =>
    queryResult({
      id: POST_ID,
      author_id: USER_ID,
      visibility: "public",
      under_review: false,
    }),
  );
  const parentMaybeSingle = vi.fn(async () => queryResult(parent));
  const rpc = vi.fn(async () => queryResult(null));
  const from = vi.fn((table: string) => {
    if (table === "community_posts") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: postMaybeSingle })),
        })),
      };
    }
    if (table === "community_comments") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: parentMaybeSingle })),
        })),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from,
    rpc,
  };
  mocks.createClientFromRequest.mockResolvedValue(client);
  mocks.createAdminClient.mockReturnValue(client);
  return { rpc };
}

function successHarness(hasCommittedReceipt = false) {
  const receipt = {
      comment: {
        id: "66666666-6666-4666-8666-666666666666",
        post_id: POST_ID,
        parent_id: null,
        author_id: USER_ID,
        content: "도움이 되는 답변",
        upvote_count: 0,
        is_deleted: false,
        created_at: "2026-07-31T00:00:00.000Z",
        updated_at: "2026-07-31T00:00:00.000Z",
        author: {
          user_id: USER_ID,
          nickname: "commenter",
          avatar_url: null,
          rank: "sprout",
          wedding_year: null,
          wedding_month: null,
        },
      },
      post_comment_count: 1,
    };
  const serviceRpc = vi.fn(
    async (name: string): Promise<{ data: unknown; error: unknown }> => queryResult(
      name === "community_replay_comment_command_service"
        ? (hasCommittedReceipt ? receipt : null)
        : receipt,
    ),
  );
  const authRpc = vi.fn();
  const authFrom = vi.fn((table: string) => {
    if (table === "community_posts") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () =>
              queryResult({
                id: POST_ID,
                author_id: "post-author",
                visibility: "public",
                under_review: false,
              }),
            ),
          })),
        })),
      };
    }
    throw new Error(`Unexpected authenticated table: ${table}`);
  });
  const serviceFrom = vi.fn((table: string) => {
    if (table === "community_profiles") {
      return {
        select: vi.fn((columns: string) => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () =>
              queryResult(
                columns === "user_id"
                  ? { user_id: USER_ID }
                  : {
                      user_id: USER_ID,
                      nickname: "답변자",
                      avatar_url: null,
                      rank: "sprout",
                      wedding_year: null,
                      wedding_month: null,
                    },
              ),
            ),
          })),
        })),
      };
    }
    throw new Error(`Unexpected service table: ${table}`);
  });
  const authenticatedClient = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from: authFrom,
    rpc: authRpc,
  };
  const serviceClient = {
    from: serviceFrom,
    rpc: serviceRpc,
  };
  mocks.createClientFromRequest.mockResolvedValue(authenticatedClient);
  mocks.createAdminClient.mockReturnValue(serviceClient);
  return {
    from: authFrom,
    rpc: serviceRpc,
    authRpc,
    serviceRpc,
    receipt,
  };
}

describe("community comments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canReadCommunityPost.mockReturnValue(true);
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("filters deleted comments out of GET before building the tree", async () => {
    const deletedEq = vi.fn(() => ({
      order: vi.fn(async () => queryResult([])),
    }));
    const postIdEq = vi.fn(() => ({ eq: deletedEq }));
    const from = vi.fn((table: string) => {
      if (table === "community_posts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () =>
                queryResult({
                  id: POST_ID,
                  author_id: USER_ID,
                  visibility: "public",
                  under_review: false,
                }),
              ),
            })),
          })),
        };
      }
      if (table === "community_comments") {
        return { select: vi.fn(() => ({ eq: postIdEq })) };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from,
    });

    const response = await GET(request("GET") as never);

    expect(response.status).toBe(200);
    expect(postIdEq).toHaveBeenCalledWith("post_id", POST_ID);
    expect(deletedEq).toHaveBeenCalledWith("is_deleted", false);
  });

  it.each([
    { label: "keeps replies below a readable author-deleted parent", deletedParents: [{ id: PARENT_ID }], lookupError: null, activeCases: [], moderationError: null, expectedStatus: 200, expectedThreads: 2 },
    { label: "keeps blocked, moderated, or missing parent subtrees hidden", deletedParents: [], lookupError: null, activeCases: [], moderationError: null, expectedStatus: 200, expectedThreads: 1 },
    { label: "fails closed when deleted-parent visibility cannot be checked", deletedParents: null, lookupError: { code: "42501" }, activeCases: [], moderationError: null, expectedStatus: 500, expectedThreads: 0 },
    { label: "keeps active moderation containment after the parent author deletes", deletedParents: [{ id: PARENT_ID }], lookupError: null, activeCases: [{ target_id: PARENT_ID }], moderationError: null, expectedStatus: 200, expectedThreads: 1 },
    { label: "fails closed when active moderation cannot be checked", deletedParents: [{ id: PARENT_ID }], lookupError: null, activeCases: null, moderationError: { code: "42501" }, expectedStatus: 500, expectedThreads: 0 },
  ])("$label", async ({ deletedParents, lookupError, activeCases, moderationError, expectedStatus, expectedThreads }) => {
    const reply = {
      id: "66666666-6666-4666-8666-666666666666",
      post_id: POST_ID,
      parent_id: PARENT_ID,
      author_id: USER_ID,
      content_origin: "member",
      content: "삭제하지 않은 다른 회원의 답글",
      upvote_count: 0,
      is_deleted: false,
      created_at: "2026-09-28T00:00:00.000Z",
      updated_at: "2026-09-28T00:00:00.000Z",
    };
    const regularParent = { ...reply, id: OTHER_POST_ID, parent_id: null };
    const regularReply = { ...reply, id: IDEMPOTENCY_KEY, parent_id: OTHER_POST_ID };
    const siblingReply = { ...reply, id: "77777777-7777-4777-8777-777777777777" };
    const visibleRows = [regularParent, reply, regularReply, siblingReply];
    const filters: Array<[string, unknown]> = [];
    const commentsQuery = {
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return commentsQuery;
      }),
      order: vi.fn(async () => queryResult(visibleRows)),
    };
    const parentFilters: Array<[string, ...unknown[]]> = [];
    const parentQuery = {
      eq: vi.fn((column: string, value: unknown) => {
        parentFilters.push(["eq", column, value]);
        return parentQuery;
      }),
      is: vi.fn((column: string, value: unknown) => {
        parentFilters.push(["is", column, value]);
        return parentQuery;
      }),
      not: vi.fn((column: string, operator: string, value: unknown) => {
        parentFilters.push(["not", column, operator, value]);
        return parentQuery;
      }),
      in: vi.fn(async (column: string, value: unknown) => {
        parentFilters.push(["in", column, value]);
        return queryResult(deletedParents, lookupError);
      }),
    };
    const from = vi.fn((table: string) => {
      if (table === "community_posts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => queryResult({
                id: POST_ID,
                author_id: USER_ID,
                visibility: "public",
                under_review: false,
              })),
            })),
          })),
        };
      }
      if (table === "community_comments") {
        return { select: vi.fn((columns: string) => {
          if (columns === "*") return commentsQuery;
          if (columns === "id") return parentQuery;
          throw new Error(`Unexpected comment projection: ${columns}`);
        }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from,
    });
    const moderationFilters: Array<[string, unknown]> = [];
    const moderationQuery = {
      eq: vi.fn((column: string, value: unknown) => {
        moderationFilters.push([column, value]);
        return moderationQuery;
      }),
      in: vi.fn(async (column: string, value: unknown) => {
        moderationFilters.push([column, value]);
        return queryResult(activeCases, moderationError);
      }),
    };
    const moderationSelect = vi.fn((columns: string) => {
      expect(columns).toBe("target_id");
      return moderationQuery;
    });
    const serviceFrom = vi.fn((table: string) => {
      expect(table).toBe("community_moderation_cases");
      return { select: moderationSelect };
    });
    mocks.createAdminClient.mockReturnValue({ from: serviceFrom });

    const response = await GET(request("GET") as never);
    const body = await response.json();

    expect(response.status).toBe(expectedStatus);
    expect(filters).toEqual([["post_id", POST_ID], ["is_deleted", false]]);
    expect(parentFilters).toEqual([
      ["eq", "post_id", POST_ID],
      ["is", "parent_id", null],
      ["eq", "is_deleted", true],
      ["not", "author_deleted_at", "is", null],
      ["in", "id", [PARENT_ID]],
    ]);
    if (expectedStatus === 200) expect(body.comments).toHaveLength(expectedThreads);
    if (!lookupError && deletedParents?.length) {
      expect(moderationFilters).toEqual([
        ["target_type", "comment"],
        ["status", "active"],
        ["target_id", [PARENT_ID]],
      ]);
    } else {
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    }
    expect(mocks.getCommunityAuthorMap).toHaveBeenCalledWith(expect.anything(), [USER_ID]);
    if (expectedStatus !== 200) {
      expect(body.comments).toBeUndefined();
      return;
    }
    expect(body.comments).toHaveLength(expectedThreads);
    expect(body.comments[0]).toMatchObject({
      id: OTHER_POST_ID,
      replies: [{ id: IDEMPOTENCY_KEY }],
    });
    if (expectedThreads === 1) {
      expect(JSON.stringify(body)).not.toContain(reply.id);
      return;
    }
    expect(body.comments[1]).toMatchObject({
      id: PARENT_ID,
      parent_id: null,
      is_deleted: true,
      author_id: "",
      content: "",
      created_at: "",
      updated_at: "",
      replies: [
        { id: reply.id, content: reply.content },
        { id: siblingReply.id, content: siblingReply.content },
      ],
    });
    expect(body.comments[1].author.user_id).not.toBe(USER_ID);
    expect(from.mock.calls.filter(([table]) => table === "community_comments")).toHaveLength(2);
  });

  it.each([
    ["missing", null, 404],
    [
      "deleted",
      { id: PARENT_ID, post_id: POST_ID, parent_id: null, is_deleted: true },
      404,
    ],
    [
      "nested",
      {
        id: PARENT_ID,
        post_id: POST_ID,
        parent_id: "another-parent",
        is_deleted: false,
      },
      400,
    ],
    [
      "from another post",
      {
        id: PARENT_ID,
        post_id: OTHER_POST_ID,
        parent_id: null,
        is_deleted: false,
      },
      400,
    ],
  ])("rejects a %s parent comment", async (_label, parent, status) => {
    const { rpc } = invalidParentHarness(parent);

    const response = await POST(
      request("POST", {
        post_id: POST_ID,
        parent_id: PARENT_ID,
        content: "답글",
      }) as never,
    );

    expect(response.status).toBe(status);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "community_replay_comment_command_service",
      expect.any(Object),
    );
  });

  it("requires one valid client idempotency key", async () => {
    successHarness();
    const response = await POST(
      request(
        "POST",
        { post_id: POST_ID, content: "답변" },
        null,
      ) as never,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_COMMENT_IDEMPOTENCY_REQUIRED",
    });
  });

  it("checks an exact receipt before returning a suspension denial", async () => {
    const { rpc } = successHarness();
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
      message: "작성 기능이 정지되었습니다.",
    });

    const response = await POST(
      request("POST", { post_id: POST_ID, content: "답변" }) as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "COMMUNITY_SUSPENDED",
      error: "작성 기능이 정지되었습니다.",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("checks an exact receipt before a fail-closed suspension lookup", async () => {
    const { rpc } = successHarness();
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      status: 503,
      code: "COMMUNITY_WRITE_ACCESS_UNAVAILABLE",
      message: "작성 상태를 확인할 수 없습니다.",
    });

    const response = await POST(
      request("POST", { post_id: POST_ID, content: "답변" }) as never,
    );

    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "name and birth date",
      "제 이름은 김민지이고 생년월일은 1993년 4월 2일이에요.",
      "name_birth_date",
    ],
    [
      "health disclosure",
      "당뇨 진단을 받아 인슐린을 복용 중이에요.",
      "health",
    ],
    [
      "vendor contract identifier",
      "웨딩홀 계약번호 VENU-2026-0042",
      "vendor_contract_identifier",
    ],
  ])("rejects a public %s before any persistence call", async (_label, content, kind) => {
    const { from, rpc } = successHarness();

    const response = await POST(
      request("POST", { post_id: POST_ID, content }) as never,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_PERSONAL_INFO_DETECTED",
      detected: expect.arrayContaining([kind]),
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      "mailto attribute",
      '<a href="mailto:victim@example.com">contact</a>',
      "contact",
    ],
    [
      "image attributes",
      '<img src="https://example.com/010-1234-5678.jpg" alt="010-1234-5678">안전한 답변',
      "안전한 답변",
    ],
  ])("never persists hidden personal info from a public %s", async (_label, content, expectedText) => {
    const { serviceRpc } = successHarness();

    const response = await POST(
      request("POST", { post_id: POST_ID, content }) as never,
    );

    expect(response.status).toBe(201);
    expect(serviceRpc).toHaveBeenCalledWith(
      "community_create_comment_with_notifications_service",
      expect.objectContaining({ p_content: expectedText }),
    );
    expect(JSON.stringify(serviceRpc.mock.calls)).not.toMatch(
      /victim@example\.com|010-1234-5678/iu,
    );
  });

  it("returns the exact committed receipt with the original 201 status", async () => {
    const { from, authRpc, serviceRpc, receipt } = successHarness(true);

    const response = await POST(
      request("POST", {
        actor_id: "99999999-9999-4999-8999-999999999999",
        post_id: POST_ID,
        content: "도움이 되는 답변",
      }) as never,
    );

    expect(response.status).toBe(201);
    expect(authRpc).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith(
      "community_replay_comment_command_service",
      {
        p_actor_id: USER_ID,
        p_post_id: POST_ID,
        p_parent_id: null,
        p_content: "도움이 되는 답변",
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
    expect(serviceRpc).not.toHaveBeenCalledWith(
      "community_create_comment_with_notifications_service",
      expect.any(Object),
    );
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("community_comments");
    await expect(response.json()).resolves.toEqual(receipt);
  });

  it("returns 409 when a key is reused for different content", async () => {
    const { rpc } = successHarness();
    rpc.mockResolvedValue(
      queryResult(null, {
        code: "23505",
        message: "COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT",
      }),
    );

    const response = await POST(
      request("POST", { post_id: POST_ID, content: "답변" }) as never,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT",
    });
  });
});

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731181000_community_reply_notifications.sql",
  ),
  "utf8",
);
const runtimeControlMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804130000_community_runtime_control.sql",
  ),
  "utf8",
);
const serviceBoundaryMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804150000_community_comment_service_write_boundary.sql",
  ),
  "utf8",
);

const POST_AUTHOR = "10000000-0000-4000-8000-000000000001";
const PARENT_AUTHOR = "10000000-0000-4000-8000-000000000002";
const REPLY_AUTHOR = "10000000-0000-4000-8000-000000000003";
const DB_POST_ID = "20000000-0000-4000-8000-000000000001";
const DB_PARENT_ID = "30000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
    );
    CREATE OR REPLACE FUNCTION public.community_request_is_service()
    RETURNS boolean LANGUAGE sql STABLE
    SET search_path = public, pg_temp
    AS $$
      SELECT CASE
        WHEN COALESCE(current_setting('request.jwt.claim.role', true), '') <> ''
          THEN current_setting('request.jwt.claim.role', true) = 'service_role'
        ELSE current_user IN ('postgres', 'service_role')
      END
    $$;
    REVOKE ALL ON FUNCTION public.community_request_is_service() FROM PUBLIC;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      nickname text NOT NULL UNIQUE,
      badge text NOT NULL DEFAULT 'member',
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      is_suspended boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false,
      comment_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      content text NOT NULL,
      upvote_count integer NOT NULL DEFAULT 0,
      is_deleted boolean NOT NULL DEFAULT false,
      author_deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "cc_select" ON public.community_comments FOR SELECT
      TO authenticated USING (true);
    CREATE POLICY "cc_insert" ON public.community_comments FOR INSERT
      TO authenticated WITH CHECK (author_id = auth.uid());
    CREATE POLICY "cc_update" ON public.community_comments FOR UPDATE
      TO authenticated USING (author_id = auth.uid());
    CREATE POLICY "cc_delete" ON public.community_comments FOR DELETE
      TO authenticated USING (author_id = auth.uid());
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON public.community_comments TO authenticated, service_role;
    GRANT SELECT ON public.community_profiles, public.community_posts
      TO authenticated, service_role;

    INSERT INTO auth.users (id) VALUES
      ('${POST_AUTHOR}'),
      ('${PARENT_AUTHOR}'),
      ('${REPLY_AUTHOR}');
    INSERT INTO public.community_profiles (user_id, nickname) VALUES
      ('${POST_AUTHOR}', 'post-author'),
      ('${PARENT_AUTHOR}', 'parent-author'),
      ('${REPLY_AUTHOR}', 'reply-author');
    INSERT INTO public.community_posts (
      id, author_id, visibility, under_review, comment_count
    ) VALUES (
      '${DB_POST_ID}', '${POST_AUTHOR}', 'public', false, 1
    );
    INSERT INTO public.community_comments (
      id, post_id, parent_id, author_id, content
    ) VALUES (
      '${DB_PARENT_ID}', '${DB_POST_ID}', NULL, '${PARENT_AUTHOR}', 'parent'
    );
  `);
  await db.exec(migration);
  await db.exec(runtimeControlMigration);
  await db.exec(serviceBoundaryMigration);
  return db;
}

async function setPersona(db: PGlite, userId: string) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
  );
  await db.exec("SET ROLE authenticated;");
}

async function setServicePersona(db: PGlite) {
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  await db.exec("SET ROLE service_role;");
}

async function setRuntimeMode(
  db: PGlite,
  mode: "normal" | "read_only" | "disabled",
) {
  await resetPersona(db);
  await setServicePersona(db);
  await db.query(
    "SELECT public.community_set_runtime_mode($1, $2, NULL::uuid)",
    [mode, `comment boundary ${mode}`],
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function createComment(
  db: PGlite,
  actorId: string,
  options: {
    parentId?: string | null;
    content?: string;
    idempotencyKey?: string;
  } = {},
) {
  await setServicePersona(db);
  return db.query<{
    result: {
      comment: { id: string; author?: { user_id: string } };
      post_comment_count: number;
    };
  }>(
    `
      SELECT public.community_create_comment_with_notifications_service(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::text,
        $5::text,
        $6::uuid
      ) AS result
    `,
    [
      actorId,
      DB_POST_ID,
      options.parentId ?? null,
      options.content ?? "useful answer",
      `user-${actorId.replace(/-/g, "").slice(0, 8)}`,
      options.idempotencyKey
        ?? "40000000-0000-4000-8000-000000000001",
    ],
  );
}

describe("community comment and notification migration", () => {
  it("deduplicates retries without duplicating counters or notifications", async () => {
    const db = await createDatabase();
    try {
      const first = await createComment(db, PARENT_AUTHOR);
      const retry = await createComment(db, PARENT_AUTHOR);
      expect(retry.rows[0]?.result).toEqual(first.rows[0]?.result);
      expect(first.rows[0]?.result).not.toHaveProperty("replayed");
      expect(first.rows[0]?.result.comment.author).toMatchObject({
        user_id: PARENT_AUTHOR,
      });

      await resetPersona(db);
      const counts = await db.query<{
        comments: number;
        notifications: number;
        post_count: number;
      }>(`
        SELECT
          (SELECT count(*)::integer
             FROM public.community_comment_commands) AS comments,
          (SELECT count(*)::integer
             FROM public.community_reply_notifications) AS notifications,
          (SELECT comment_count
             FROM public.community_posts
            WHERE id = '${DB_POST_ID}') AS post_count
      `);
      expect(counts.rows).toEqual([{
        comments: 1,
        notifications: 1,
        post_count: 2,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("returns the committed receipt before runtime and suspension gates", async () => {
    const db = await createDatabase();
    const idempotencyKey = "40000000-0000-4000-8000-000000000041";
    try {
      const first = await createComment(db, PARENT_AUTHOR, {
        idempotencyKey,
        content: "receipt survives policy transition",
      });
      await setRuntimeMode(db, "read_only");
      await resetPersona(db);
      await db.query(`
        UPDATE public.community_profiles
           SET is_suspended = true
         WHERE user_id = '${PARENT_AUTHOR}'
      `);

      const retry = await createComment(db, PARENT_AUTHOR, {
        idempotencyKey,
        content: "receipt survives policy transition",
      });
      expect(retry.rows[0]?.result).toEqual(first.rows[0]?.result);

      await expect(createComment(db, PARENT_AUTHOR, {
        idempotencyKey,
        content: "different payload",
      })).rejects.toThrow(/COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT/u);

      await setServicePersona(db);
      const preflight = await db.query<{ result: unknown }>(`
        SELECT public.community_replay_comment_command_service(
          '${PARENT_AUTHOR}'::uuid,
          '${DB_POST_ID}'::uuid,
          NULL::uuid,
          'receipt survives policy transition'::text,
          '${idempotencyKey}'::uuid
        ) AS result
      `);
      expect(preflight.rows[0]?.result).toEqual(first.rows[0]?.result);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed instead of reconstructing missing or corrupted receipts", async () => {
    const db = await createDatabase();
    const missingKey = "40000000-0000-4000-8000-000000000051";
    const corruptedKey = "40000000-0000-4000-8000-000000000052";
    try {
      await createComment(db, PARENT_AUTHOR, {
        idempotencyKey: missingKey,
        content: "missing receipt command",
      });
      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_comment_commands
        SET response_payload = NULL, response_digest = NULL
        WHERE author_id = '${PARENT_AUTHOR}'
          AND idempotency_key = '${missingKey}'
      `);
      await expect(createComment(db, PARENT_AUTHOR, {
        idempotencyKey: missingKey,
        content: "missing receipt command",
      })).rejects.toThrow(/COMMUNITY_COMMENT_RECEIPT_INVALID/u);

      await resetPersona(db);
      const created = await createComment(db, PARENT_AUTHOR, {
        idempotencyKey: corruptedKey,
        content: "corrupted receipt command",
      });
      const commentId = created.rows[0]!.result.comment.id;
      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_comment_commands
        SET response_payload = jsonb_set(
          response_payload,
          '{post_comment_count}',
          '999'::jsonb
        )
        WHERE author_id = '${PARENT_AUTHOR}'
          AND idempotency_key = '${corruptedKey}';
      `);
      await expect(createComment(db, PARENT_AUTHOR, {
        idempotencyKey: corruptedKey,
        content: "corrupted receipt command",
      })).rejects.toThrow(/COMMUNITY_COMMENT_RECEIPT_DIGEST_MISMATCH/u);

      await resetPersona(db);
      await setServicePersona(db);
      await db.query(`
        SELECT public.community_delete_comment_service(
          '${PARENT_AUTHOR}'::uuid,
          '${commentId}'::uuid
        )
      `);
      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_comment_delete_receipts
        SET response_payload = jsonb_set(
          response_payload,
          '{post_comment_count}',
          '777'::jsonb
        )
        WHERE actor_id = '${PARENT_AUTHOR}'
          AND comment_id = '${commentId}'
      `);
      await setServicePersona(db);
      await expect(db.query(`
        SELECT public.community_delete_comment_service(
          '${PARENT_AUTHOR}'::uuid,
          '${commentId}'::uuid
        )
      `)).rejects.toThrow(/COMMUNITY_COMMENT_DELETE_RECEIPT_DIGEST_MISMATCH/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("deletes a comment and both counters atomically, then replays safely", async () => {
    const db = await createDatabase();
    try {
      const created = await createComment(db, PARENT_AUTHOR, {
        idempotencyKey: "40000000-0000-4000-8000-000000000042",
      });
      const commentId = created.rows[0]?.result.comment.id;
      await setServicePersona(db);
      const first = await db.query<{
        result: { comment_id: string; post_comment_count: number };
      }>(`
        SELECT public.community_delete_comment_service(
          '${PARENT_AUTHOR}'::uuid,
          '${commentId}'::uuid
        ) AS result
      `);
      const retry = await db.query<{
        result: { comment_id: string; post_comment_count: number };
      }>(`
        SELECT public.community_delete_comment_service(
          '${PARENT_AUTHOR}'::uuid,
          '${commentId}'::uuid
        ) AS result
      `);
      expect(retry.rows[0]?.result).toEqual(first.rows[0]?.result);
      expect(first.rows[0]?.result).toEqual({
        comment_id: commentId,
        post_comment_count: 1,
      });

      await resetPersona(db);
      const state = await db.query<{
        author_deleted: boolean;
        content: string;
        post_count: number;
        profile_count: number;
      }>(`
        SELECT comment.author_deleted_at IS NOT NULL AS author_deleted,
          comment.content,
          post.comment_count AS post_count,
          profile.comment_count AS profile_count
        FROM public.community_comments AS comment
        JOIN public.community_posts AS post ON post.id = comment.post_id
        JOIN public.community_profiles AS profile ON profile.user_id = comment.author_id
        WHERE comment.id = '${commentId}'
      `);
      expect(state.rows).toEqual([{
        author_deleted: true,
        content: "삭제된 댓글입니다.",
        post_count: 1,
        profile_count: 0,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls author deletion back if either counter cannot commit", async () => {
    const db = await createDatabase();
    try {
      const created = await createComment(db, PARENT_AUTHOR, {
        idempotencyKey: "40000000-0000-4000-8000-000000000043",
      });
      const commentId = created.rows[0]?.result.comment.id;
      await resetPersona(db);
      await db.exec(`
        CREATE FUNCTION public.fail_comment_profile_decrement()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.comment_count < OLD.comment_count THEN
            RAISE EXCEPTION 'profile counter unavailable';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER fail_comment_profile_decrement
          BEFORE UPDATE ON public.community_profiles
          FOR EACH ROW EXECUTE FUNCTION public.fail_comment_profile_decrement();
      `);
      await setServicePersona(db);
      await expect(db.query(`
        SELECT public.community_delete_comment_service(
          '${PARENT_AUTHOR}'::uuid,
          '${commentId}'::uuid
        )
      `)).rejects.toThrow(/profile counter unavailable/u);

      await resetPersona(db);
      const state = await db.query<{
        author_deleted: boolean;
        post_count: number;
        profile_count: number;
      }>(`
        SELECT comment.author_deleted_at IS NOT NULL AS author_deleted,
          post.comment_count AS post_count,
          profile.comment_count AS profile_count
        FROM public.community_comments AS comment
        JOIN public.community_posts AS post ON post.id = comment.post_id
        JOIN public.community_profiles AS profile ON profile.user_id = comment.author_id
        WHERE comment.id = '${commentId}'
      `);
      expect(state.rows).toEqual([{
        author_deleted: false,
        post_count: 2,
        profile_count: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("deduplicates concurrently submitted callers by the same idempotency key", async () => {
    const db = await createDatabase();
    const idempotencyKey = "40000000-0000-4000-8000-000000000021";
    try {
      await setServicePersona(db);
      const submit = () => db.query<{
        result: {
          comment: { id: string };
          replayed: boolean;
          post_comment_count: number;
        };
      }>(`
        SELECT public.community_create_comment_with_notifications_service(
          $1::uuid, $2::uuid, NULL::uuid, $3::text,
          'user-10000000'::text, $4::uuid
        ) AS result
      `, [PARENT_AUTHOR, DB_POST_ID, "concurrent answer", idempotencyKey]);

      const [left, right] = await Promise.all([submit(), submit()]);
      const results = [left.rows[0].result, right.rows[0].result];
      expect(results[1]).toEqual(results[0]);
      expect(results[0]).not.toHaveProperty("replayed");
      expect(new Set(results.map((result) => result.comment.id)).size).toBe(1);

      await resetPersona(db);
      const counts = await db.query<{
        commands: number;
        comments: number;
        notifications: number;
      }>(`
        SELECT
          (SELECT count(*)::integer
             FROM public.community_comment_commands) AS commands,
          (SELECT count(*)::integer
             FROM public.community_comments
            WHERE id <> '${DB_PARENT_ID}') AS comments,
          (SELECT count(*)::integer
             FROM public.community_reply_notifications) AS notifications
      `);
      expect(counts.rows).toEqual([{
        commands: 1,
        comments: 1,
        notifications: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed for an unverified service caller, unknown actor, and mismatched parent path", async () => {
    const db = await createDatabase();
    const unknownActor = "10000000-0000-4000-8000-000000000099";
    const otherPost = "20000000-0000-4000-8000-000000000099";
    const otherParent = "30000000-0000-4000-8000-000000000099";
    try {
      await expect(db.query(`
        SELECT public.community_create_comment_with_notifications_service(
          '${REPLY_AUTHOR}'::uuid,
          '${DB_POST_ID}'::uuid,
          NULL::uuid,
          'no verified service claim'::text,
          'user-10000000'::text,
          '40000000-0000-4000-8000-000000000010'::uuid
        )
      `)).rejects.toThrow(/COMMUNITY_SERVICE_ROLE_REQUIRED/u);

      await setServicePersona(db);
      await expect(db.query(`
        SELECT public.community_create_comment_with_notifications_service(
          '${unknownActor}'::uuid,
          '${DB_POST_ID}'::uuid,
          NULL::uuid,
          'unknown actor'::text,
          'user-10000000'::text,
          '40000000-0000-4000-8000-000000000011'::uuid
        )
      `)).rejects.toThrow(/COMMUNITY_COMMENT_ACTOR_NOT_FOUND/u);

      await resetPersona(db);
      await db.exec(`
        INSERT INTO public.community_posts (
          id, author_id, visibility, under_review, comment_count
        ) VALUES (
          '${otherPost}', '${POST_AUTHOR}', 'public', false, 1
        );
        INSERT INTO public.community_comments (
          id, post_id, parent_id, author_id, content
        ) VALUES (
          '${otherParent}', '${otherPost}', NULL, '${PARENT_AUTHOR}', 'other parent'
        );
      `);
      await setServicePersona(db);
      await expect(db.query(`
        SELECT public.community_create_comment_with_notifications_service(
          '${REPLY_AUTHOR}'::uuid,
          '${DB_POST_ID}'::uuid,
          '${otherParent}'::uuid,
          'wrong path'::text,
          'user-10000000'::text,
          '40000000-0000-4000-8000-000000000012'::uuid
        )
      `)).rejects.toThrow(/COMMUNITY_PARENT_POST_MISMATCH/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("does not notify someone about their own answer", async () => {
    const db = await createDatabase();
    try {
      await createComment(db, POST_AUTHOR);
      await resetPersona(db);
      const result = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.community_reply_notifications
      `);
      expect(result.rows).toEqual([{ count: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("notifies both the post author and parent-answer author once", async () => {
    const db = await createDatabase();
    try {
      await createComment(db, REPLY_AUTHOR, {
        parentId: DB_PARENT_ID,
      });
      await resetPersona(db);
      const result = await db.query<{
        recipient_id: string;
        kind: string;
      }>(`
        SELECT recipient_id, kind
        FROM public.community_reply_notifications
        ORDER BY recipient_id
      `);
      expect(result.rows).toEqual([
        { recipient_id: POST_AUTHOR, kind: "post_reply" },
        { recipient_id: PARENT_AUTHOR, kind: "comment_reply" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects suspended members and conflicting key reuse", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.community_profiles
           SET is_suspended = true
         WHERE user_id = '${REPLY_AUTHOR}'
      `);
      await expect(createComment(db, REPLY_AUTHOR)).rejects.toThrow(
        /COMMUNITY_SUSPENDED/u,
      );
      await resetPersona(db);
      await createComment(db, PARENT_AUTHOR);
      await expect(createComment(db, PARENT_AUTHOR, {
        content: "different content",
      })).rejects.toThrow(/COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("bootstraps and increments a missing actor profile in the same transaction", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        DELETE FROM public.community_profiles
        WHERE user_id = '${REPLY_AUTHOR}'
      `);

      await createComment(db, REPLY_AUTHOR, {
        idempotencyKey: "40000000-0000-4000-8000-000000000031",
      });
      await resetPersona(db);
      const result = await db.query<{
        comments: number;
        profile_count: number;
        nickname: string | null;
      }>(`
        SELECT
          (SELECT count(*)::integer
           FROM public.community_comments
           WHERE author_id = '${REPLY_AUTHOR}') AS comments,
          (SELECT comment_count
           FROM public.community_profiles
           WHERE user_id = '${REPLY_AUTHOR}') AS profile_count,
          (SELECT nickname
           FROM public.community_profiles
           WHERE user_id = '${REPLY_AUTHOR}') AS nickname
      `);
      expect(result.rows).toEqual([{
        comments: 1,
        profile_count: 1,
        nickname: "user-10000000",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("uses a stable collision fallback without splitting profile and comment commits", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        DELETE FROM public.community_profiles
        WHERE user_id = '${REPLY_AUTHOR}';
        UPDATE public.community_profiles
        SET nickname = 'user-10000000'
        WHERE user_id = '${PARENT_AUTHOR}';
      `);

      await createComment(db, REPLY_AUTHOR, {
        idempotencyKey: "40000000-0000-4000-8000-000000000032",
      });
      await resetPersona(db);
      const profile = await db.query<{
        nickname: string;
        comment_count: number;
      }>(`
        SELECT nickname, comment_count
        FROM public.community_profiles
        WHERE user_id = '${REPLY_AUTHOR}'
      `);
      expect(profile.rows).toEqual([{
        nickname: "u-8000000000000003",
        comment_count: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("locks runtime and suspension truth before creating a comment", () => {
    expect(serviceBoundaryMigration).toMatch(
      /FROM public\.community_runtime_control[\s\S]*FOR SHARE/iu,
    );
    expect(serviceBoundaryMigration).toMatch(
      /FROM public\.community_profiles[\s\S]*FOR UPDATE/iu,
    );
  });

  it("revokes the legacy authenticated RPC before exposing the service boundary", async () => {
    const db = await createDatabase();
    try {
      const rpcPrivileges = await db.query<{
        authenticated_can_execute: boolean;
        anon_can_execute: boolean;
        service_can_execute: boolean;
        authenticated_can_execute_service: boolean;
        service_can_execute_service: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'authenticated',
            'public.community_create_comment_with_notifications(uuid,uuid,text,uuid)',
            'EXECUTE'
          ) AS authenticated_can_execute,
          has_function_privilege(
            'anon',
            'public.community_create_comment_with_notifications(uuid,uuid,text,uuid)',
            'EXECUTE'
          ) AS anon_can_execute,
          has_function_privilege(
            'service_role',
            'public.community_create_comment_with_notifications(uuid,uuid,text,uuid)',
            'EXECUTE'
          ) AS service_can_execute,
          has_function_privilege(
            'authenticated',
            'public.community_create_comment_with_notifications_service(uuid,uuid,uuid,text,text,uuid)',
            'EXECUTE'
          ) AS authenticated_can_execute_service,
          has_function_privilege(
            'service_role',
            'public.community_create_comment_with_notifications_service(uuid,uuid,uuid,text,text,uuid)',
            'EXECUTE'
          ) AS service_can_execute_service
      `);
      expect(rpcPrivileges.rows).toEqual([{
        authenticated_can_execute: false,
        anon_can_execute: false,
        service_can_execute: false,
        authenticated_can_execute_service: false,
        service_can_execute_service: true,
      }]);

      await setPersona(db, REPLY_AUTHOR);
      await expect(db.query(`
        SELECT public.community_create_comment_with_notifications(
          '${DB_POST_ID}'::uuid,
          NULL::uuid,
          'bypass'::text,
          '40000000-0000-4000-8000-000000000001'::uuid
        )
      `)).rejects.toThrow(/permission denied/iu);

      await expect(db.query(`
        SELECT public.community_create_comment_with_notifications_service(
          '${REPLY_AUTHOR}'::uuid,
          '${DB_POST_ID}'::uuid,
          NULL::uuid,
          'spoofed actor path'::text,
          'user-10000000'::text,
          '40000000-0000-4000-8000-000000000002'::uuid
        )
      `)).rejects.toThrow(/permission denied/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("limits direct writes, visibility, and read updates to the recipient", async () => {
    const db = await createDatabase();
    try {

      await setPersona(db, REPLY_AUTHOR);
      await expect(db.exec(`
        INSERT INTO public.community_comments (
          post_id, author_id, content
        ) VALUES (
          '${DB_POST_ID}',
          '${REPLY_AUTHOR}',
          'bypass'
        )
      `)).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await createComment(db, REPLY_AUTHOR, { parentId: DB_PARENT_ID });
      await resetPersona(db);

      await setPersona(db, POST_AUTHOR);
      const own = await db.query<{ id: string }>(`
        SELECT id FROM public.community_reply_notifications
      `);
      expect(own.rows).toHaveLength(1);
      const ownId = own.rows[0]?.id;

      await resetPersona(db);
      await setPersona(db, REPLY_AUTHOR);
      const actorsView = await db.query<{ id: string }>(`
        SELECT id FROM public.community_reply_notifications
      `);
      expect(actorsView.rows).toEqual([]);
      const crossRead = await db.query<{ id: string }>(`
        UPDATE public.community_reply_notifications
           SET read_at = now()
         WHERE id = '${ownId}'
        RETURNING id
      `);
      expect(crossRead.rows).toEqual([]);

      await resetPersona(db);
      await setPersona(db, POST_AUTHOR);
      const ownRead = await db.query<{ id: string }>(`
        UPDATE public.community_reply_notifications
           SET read_at = now()
         WHERE id = '${ownId}'
        RETURNING id
      `);
      expect(ownRead.rows).toEqual([{ id: ownId }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls the comment and counters back if notification creation fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.fail_community_notification()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'notification delivery persistence failed';
        END;
        $$;
        CREATE TRIGGER fail_community_notification
        BEFORE INSERT ON public.community_reply_notifications
        FOR EACH ROW EXECUTE FUNCTION public.fail_community_notification();
      `);

      await expect(createComment(db, PARENT_AUTHOR)).rejects.toThrow(
        /notification delivery persistence failed/u,
      );
      await resetPersona(db);
      const result = await db.query<{
        comments: number;
        post_count: number;
      }>(`
        SELECT
          (SELECT count(*)::integer
             FROM public.community_comment_commands) AS comments,
          (SELECT comment_count
             FROM public.community_posts
            WHERE id = '${DB_POST_ID}') AS post_count
      `);
      expect(result.rows).toEqual([{ comments: 0, post_count: 1 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps ordinary service comments blocked and atomic while runtime is read-only", async () => {
    const db = await createDatabase();
    try {
      await setRuntimeMode(db, "read_only");
      await expect(createComment(db, PARENT_AUTHOR)).rejects.toThrow(
        /community is read-only/iu,
      );

      await resetPersona(db);
      const result = await db.query<{
        comments: number;
        commands: number;
        notifications: number;
        post_count: number;
        profile_count: number;
      }>(`
        SELECT
          (SELECT count(*)::integer
             FROM public.community_comments
            WHERE id <> '${DB_PARENT_ID}') AS comments,
          (SELECT count(*)::integer
             FROM public.community_comment_commands) AS commands,
          (SELECT count(*)::integer
             FROM public.community_reply_notifications) AS notifications,
          (SELECT comment_count
             FROM public.community_posts
            WHERE id = '${DB_POST_ID}') AS post_count,
          (SELECT comment_count
             FROM public.community_profiles
            WHERE user_id = '${PARENT_AUTHOR}') AS profile_count
      `);
      expect(result.rows).toEqual([{
        comments: 0,
        commands: 0,
        notifications: 0,
        post_count: 1,
        profile_count: 0,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
