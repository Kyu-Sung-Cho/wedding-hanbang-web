// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802190000_community_idempotent_writes.sql",
);

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const OUTSIDER = "10000000-0000-4000-8000-000000000003";
const POST_ID = "20000000-0000-4000-8000-000000000001";
const ROOM_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_ROOM_ID = "30000000-0000-4000-8000-000000000002";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";

const databases: PGlite[] = [];

async function createDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id),
      is_suspended boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      bookmark_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.community_bookmarks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      post_id uuid NOT NULL REFERENCES public.community_posts(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, post_id)
    );
    CREATE TABLE public.cohort_rooms (
      id uuid PRIMARY KEY,
      message_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL REFERENCES public.cohort_rooms(id),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      is_active boolean NOT NULL DEFAULT true,
      UNIQUE (room_id, user_id)
    );
    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL REFERENCES public.cohort_rooms(id),
      author_id uuid NOT NULL REFERENCES auth.users(id),
      content text NOT NULL,
      thread_topic text,
      images text[] DEFAULT '{}',
      reply_to uuid REFERENCES public.cohort_messages(id),
      is_deleted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.test_message_count()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE public.cohort_rooms
      SET message_count = message_count + 1
      WHERE id = NEW.room_id;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER test_message_count
      AFTER INSERT ON public.cohort_messages
      FOR EACH ROW EXECUTE FUNCTION public.test_message_count();

    INSERT INTO auth.users(id) VALUES ('${USER_A}'), ('${USER_B}'), ('${OUTSIDER}');
    INSERT INTO public.community_profiles(user_id) VALUES ('${USER_A}'), ('${USER_B}'), ('${OUTSIDER}');
    INSERT INTO public.community_posts(id) VALUES ('${POST_ID}');
    INSERT INTO public.cohort_rooms(id) VALUES ('${ROOM_ID}'), ('${OTHER_ROOM_ID}');
    INSERT INTO public.cohort_members(room_id, user_id) VALUES
      ('${ROOM_ID}', '${USER_A}'), ('${ROOM_ID}', '${USER_B}');
  `);
  await db.exec(readFileSync(migrationPath, "utf8"));
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

async function setBookmark(
  db: PGlite,
  userId: string,
  bookmarked: boolean,
) {
  const result = await db.query<{ result: { bookmarked: boolean; bookmark_count: number } }>(
    "SELECT public.community_set_post_bookmark($1, $2, $3) AS result",
    [userId, POST_ID, bookmarked],
  );
  return result.rows[0]?.result;
}

async function createMessage(
  db: PGlite,
  overrides: { userId?: string; requestId?: string; content?: string; replyTo?: string | null } = {},
) {
  const result = await db.query<{ result: Record<string, unknown> }>(`
    SELECT public.community_create_cohort_message(
      $1, $2, $3, $4, $5, $6
    ) AS result
  `, [
    overrides.userId ?? USER_A,
    ROOM_ID,
    overrides.requestId ?? REQUEST_ID,
    overrides.content ?? "같은 요청은 한 번만 저장해요.",
    "chat",
    overrides.replyTo ?? null,
  ]);
  return result.rows[0]?.result;
}

describe("idempotent community writes migration", () => {
  it("sets bookmark intent idempotently and derives the exact count", async () => {
    const db = await createDatabase();

    await expect(setBookmark(db, USER_A, true)).resolves.toEqual({
      bookmarked: true,
      bookmark_count: 1,
    });
    await expect(setBookmark(db, USER_A, true)).resolves.toEqual({
      bookmarked: true,
      bookmark_count: 1,
    });
    await expect(setBookmark(db, USER_B, true)).resolves.toEqual({
      bookmarked: true,
      bookmark_count: 2,
    });
    await expect(setBookmark(db, USER_A, false)).resolves.toEqual({
      bookmarked: false,
      bookmark_count: 1,
    });
    await expect(setBookmark(db, USER_A, false)).resolves.toEqual({
      bookmarked: false,
      bookmark_count: 1,
    });
  });

  it("stores one cohort message for repeated delivery of the same request", async () => {
    const db = await createDatabase();

    const first = await createMessage(db);
    const replay = await createMessage(db);

    expect(first).toMatchObject({ replayed: false, client_request_id: REQUEST_ID });
    expect(replay).toMatchObject({
      replayed: true,
      id: first?.id,
      client_request_id: REQUEST_ID,
    });
    const counts = await db.query<{ messages: number; cached: number }>(`
      SELECT count(message.id)::integer AS messages, room.message_count AS cached
      FROM public.cohort_rooms AS room
      LEFT JOIN public.cohort_messages AS message ON message.room_id = room.id
      WHERE room.id = $1
      GROUP BY room.id, room.message_count
    `, [ROOM_ID]);
    expect(counts.rows[0]).toEqual({ messages: 1, cached: 1 });
  });

  it("rejects request-key payload drift, outsiders, and cross-room replies", async () => {
    const db = await createDatabase();
    await createMessage(db);
    await expect(createMessage(db, { content: "changed payload" }))
      .rejects.toThrow(/idempotency key reused/i);
    await expect(createMessage(db, { userId: OUTSIDER }))
      .rejects.toThrow(/active cohort member/i);

    const otherMessage = await db.query<{ id: string }>(`
      INSERT INTO public.cohort_messages(room_id, author_id, content)
      VALUES ($1, $2, 'other room') RETURNING id
    `, [OTHER_ROOM_ID, USER_A]);
    await expect(createMessage(db, {
      requestId: "40000000-0000-4000-8000-000000000002",
      replyTo: otherMessage.rows[0]?.id,
    })).rejects.toThrow(/reply target/i);
  });

  it("keeps both write RPCs service-role only", async () => {
    const db = await createDatabase();
    await db.exec("SET ROLE authenticated");
    await expect(setBookmark(db, USER_A, true)).rejects.toThrow(/permission denied/i);
    await expect(createMessage(db)).rejects.toThrow(/permission denied/i);
  });
});

describe("idempotent community route contract", () => {
  it("uses desired bookmark state instead of a server-side toggle", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "src/app/api/community/posts/[id]/bookmark/route.ts",
    ), "utf8");
    expect(source).toContain("community_set_post_bookmark");
    expect(source).toContain("body.bookmarked");
    expect(source).not.toContain("if (existing)");
  });

  it("requires a client request key and delegates message creation to one RPC", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "src/app/api/community/cohort/[id]/messages/route.ts",
    ), "utf8");
    const post = source.slice(source.indexOf("export async function POST"));
    expect(post).toContain('req.headers.get("idempotency-key")');
    expect(post).toContain("community_create_cohort_message");
    expect(post).not.toMatch(/\.from\("cohort_messages"\)\s*\n\s*\.insert/);
  });
});
