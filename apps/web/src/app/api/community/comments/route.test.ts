// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
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
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "comment-rate-key"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
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
  checkRateLimit: mocks.checkRateLimit,
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
  const rpc = vi.fn();
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
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from,
    rpc,
  });
  return { rpc };
}

function successHarness(replayed = false) {
  const rpc = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
    queryResult({
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
      },
      replayed,
      post_comment_count: 1,
    }),
  );
  const from = vi.fn((table: string) => {
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
    throw new Error(`Unexpected table: ${table}`);
  });
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from,
    rpc,
  });
  return { from, rpc };
}

describe("community comments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canReadCommunityPost.mockReturnValue(true);
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimit.mockReturnValue(null);
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
    expect(rpc).not.toHaveBeenCalled();
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

  it("returns the shared suspension denial without reaching the RPC", async () => {
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
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when suspension status cannot be checked", async () => {
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
    expect(rpc).not.toHaveBeenCalled();
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
  });

  it("uses only the authenticated atomic RPC and returns a replay as 200", async () => {
    const { from, rpc } = successHarness(true);

    const response = await POST(
      request("POST", {
        post_id: POST_ID,
        content: "도움이 되는 답변",
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "community_create_comment_with_notifications",
      {
        p_post_id: POST_ID,
        p_parent_id: null,
        p_content: "도움이 되는 답변",
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
    expect(from).not.toHaveBeenCalledWith("community_comments");
    await expect(response.json()).resolves.toMatchObject({
      replayed: true,
      comment: {
        id: "66666666-6666-4666-8666-666666666666",
        author: { nickname: "답변자" },
      },
    });
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

const POST_AUTHOR = "10000000-0000-4000-8000-000000000001";
const PARENT_AUTHOR = "10000000-0000-4000-8000-000000000002";
const REPLY_AUTHOR = "10000000-0000-4000-8000-000000000003";
const DB_POST_ID = "20000000-0000-4000-8000-000000000001";
const DB_PARENT_ID = "30000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
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
  return db;
}

async function setPersona(db: PGlite, userId: string) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
  );
  await db.exec("SET ROLE authenticated;");
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
  await setPersona(db, actorId);
  return db.query<{ result: { comment: { id: string }; replayed: boolean } }>(
    `
      SELECT public.community_create_comment_with_notifications(
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::uuid
      ) AS result
    `,
    [
      DB_POST_ID,
      options.parentId ?? null,
      options.content ?? "useful answer",
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
      expect(first.rows[0]?.result.replayed).toBe(false);
      expect(retry.rows[0]?.result).toEqual(expect.objectContaining({
        comment: expect.objectContaining({
          id: first.rows[0]?.result.comment.id,
        }),
        replayed: true,
        post_comment_count: 2,
      }));

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

  it("limits direct writes, visibility, and read updates to the recipient", async () => {
    const db = await createDatabase();
    try {
      const rpcPrivileges = await db.query<{
        authenticated_can_execute: boolean;
        anon_can_execute: boolean;
        service_can_execute: boolean;
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
          ) AS service_can_execute
      `);
      expect(rpcPrivileges.rows).toEqual([{
        authenticated_can_execute: true,
        anon_can_execute: false,
        service_can_execute: false,
      }]);

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
});
