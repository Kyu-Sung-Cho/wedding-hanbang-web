// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802120000_lock_server_trusted_fields.sql",
  ),
  "utf8",
);

const postRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/posts/[id]/route.ts"),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const BOOKING_ID = "30000000-0000-4000-8000-000000000001";
const REVIEW_ID = "40000000-0000-4000-8000-000000000001";
const POST_ID = "50000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      name text,
      email text,
      couple_id uuid,
      role text,
      is_admin boolean NOT NULL DEFAULT false,
      push_token text,
      onboarding_completed boolean NOT NULL DEFAULT false,
      onboarding_step integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      owner_id uuid,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      is_verified boolean NOT NULL DEFAULT false,
      ai_recommend boolean NOT NULL DEFAULT false,
      rating numeric NOT NULL DEFAULT 0,
      review_count integer NOT NULL DEFAULT 0,
      commission_rate numeric NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      amount numeric,
      actual_amount numeric,
      payment_status text,
      receipt_verified_at timestamptz,
      receipt_verified_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_reviews (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      booking_id uuid REFERENCES public.vendor_bookings(id),
      customer_id uuid,
      rating smallint NOT NULL,
      content text,
      reply text,
      replied_at timestamptz,
      is_visible boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      avatar_url text,
      badge text NOT NULL DEFAULT 'member',
      rank text NOT NULL DEFAULT 'sprout',
      wedding_year integer,
      wedding_month integer,
      wedding_completed boolean NOT NULL DEFAULT false,
      progress_percent integer NOT NULL DEFAULT 0,
      region text,
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      warning_count integer NOT NULL DEFAULT 0,
      is_suspended boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      category text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      images text[] NOT NULL DEFAULT '{}',
      slides jsonb,
      visibility text NOT NULL DEFAULT 'public',
      ad_disclosure text NOT NULL DEFAULT 'general',
      sponsorship_detail text,
      ai_comment jsonb,
      is_resolved boolean NOT NULL DEFAULT false,
      is_verified_review boolean NOT NULL DEFAULT false,
      verification_doc_url text,
      price_data jsonb,
      is_quick_review boolean NOT NULL DEFAULT false,
      rating smallint,
      cohort_room_id uuid,
      under_review boolean NOT NULL DEFAULT false,
      upvote_count integer NOT NULL DEFAULT 0,
      downvote_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      view_count integer NOT NULL DEFAULT 0,
      bookmark_count integer NOT NULL DEFAULT 0,
      is_pinned boolean NOT NULL DEFAULT false,
      is_weekly_best boolean NOT NULL DEFAULT false,
      vendor_tags uuid[] NOT NULL DEFAULT '{}',
      tags text[] NOT NULL DEFAULT '{}',
      cost_data jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_bookings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_reviews ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

    GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vendors TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.vendor_bookings TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.vendor_reviews TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.community_profiles TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_posts TO authenticated;
    GRANT ALL ON TABLE
      public.profiles,
      public.vendors,
      public.vendor_bookings,
      public.vendor_reviews,
      public.community_profiles,
      public.community_posts
    TO service_role;

    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT TO authenticated USING (id = auth.uid());
    CREATE POLICY profiles_insert_own ON public.profiles
      FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

    CREATE POLICY vendors_insert_own ON public.vendors
      FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
    CREATE POLICY vendors_update_own ON public.vendors
      FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
    CREATE POLICY vendors_delete_own ON public.vendors
      FOR DELETE TO authenticated USING (owner_id = auth.uid());
    CREATE POLICY "업체: 신규 등록" ON public.vendors
      FOR INSERT WITH CHECK (owner_id = auth.uid());
    CREATE POLICY "업체: 본인 업체 수정" ON public.vendors
      FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
    CREATE POLICY "서비스: vendors 전체 관리" ON public.vendors
      FOR ALL USING (auth.role() = 'service_role');

    CREATE POLICY vendor_bookings_insert ON public.vendor_bookings
      FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY vendor_bookings_update ON public.vendor_bookings
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

    CREATE POLICY vendor_reviews_insert ON public.vendor_reviews
      FOR INSERT TO authenticated WITH CHECK (customer_id = auth.uid());
    CREATE POLICY vendor_reviews_update_own ON public.vendor_reviews
      FOR UPDATE TO authenticated USING (customer_id = auth.uid());
    CREATE POLICY "고객: 리뷰 작성" ON public.vendor_reviews
      FOR INSERT WITH CHECK (customer_id = auth.uid());
    CREATE POLICY "고객: 본인 리뷰 수정" ON public.vendor_reviews
      FOR UPDATE USING (customer_id = auth.uid());
    CREATE POLICY "업체: 리뷰 답변" ON public.vendor_reviews
      FOR UPDATE USING (true);
    CREATE POLICY "서비스: 리뷰 전체 관리" ON public.vendor_reviews
      FOR ALL USING (auth.role() = 'service_role');

    CREATE POLICY community_profiles_insert ON public.community_profiles
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
    CREATE POLICY community_profiles_update ON public.community_profiles
      FOR UPDATE TO authenticated USING (user_id = auth.uid());

    CREATE POLICY cp_insert ON public.community_posts
      FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
    CREATE POLICY cp_update ON public.community_posts
      FOR UPDATE TO authenticated USING (author_id = auth.uid());
    CREATE POLICY cp_delete ON public.community_posts
      FOR DELETE TO authenticated USING (author_id = auth.uid());

    INSERT INTO public.profiles (id, name) VALUES
      ('${USER_ID}', 'User'),
      ('${OTHER_USER_ID}', 'Other');
    INSERT INTO public.vendors (id, owner_id, name)
    VALUES ('${VENDOR_ID}', '${USER_ID}', 'Vendor');
    INSERT INTO public.vendor_bookings (id, vendor_id, couple_id, amount)
    VALUES ('${BOOKING_ID}', '${VENDOR_ID}', '${COUPLE_ID}', 500000);
    INSERT INTO public.vendor_reviews (
      id, vendor_id, booking_id, customer_id, rating, content
    ) VALUES (
      '${REVIEW_ID}', '${VENDOR_ID}', '${BOOKING_ID}', '${USER_ID}', 4, 'Review'
    );
    INSERT INTO public.community_profiles (user_id, nickname)
    VALUES ('${USER_ID}', 'nickname');
    INSERT INTO public.community_posts (id, author_id, category, title, content)
    VALUES ('${POST_ID}', '${USER_ID}', 'free', 'Title', 'Content');
  `);
  return db;
}

async function applyMigration(db: PGlite) {
  await db.exec(migration);
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
  userId = "",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("server-trusted field write fence migration", () => {
  it("contains no target-row mutation and routes post edits through the service boundary", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:profiles|vendors|vendor_bookings|vendor_reviews|community_profiles|community_posts)\b/i,
    );
    expect(postRoute).toContain("const writeClient = getServiceClient();");
    expect(postRoute).not.toContain(
      "const writeClient = userIsAdmin ? getServiceClient() : supabase;",
    );
  });

  it("removes direct authenticated INSERT/UPDATE and the canonical post DELETE bypass", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);

      const privileges = await db.query<Record<string, boolean>>(`
        SELECT
          has_table_privilege('authenticated', 'public.profiles', 'INSERT') AS profile_insert,
          has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'INSERT') AS profile_admin_insert,
          has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE') AS profile_admin_update,
          has_column_privilege('authenticated', 'public.profiles', 'push_token', 'UPDATE') AS profile_push_update,
          has_any_column_privilege('authenticated', 'public.vendors', 'INSERT') AS vendor_insert,
          has_any_column_privilege('authenticated', 'public.vendors', 'UPDATE') AS vendor_update,
          has_table_privilege('authenticated', 'public.vendors', 'DELETE') AS vendor_delete,
          has_any_column_privilege('authenticated', 'public.vendor_bookings', 'INSERT') AS booking_insert,
          has_any_column_privilege('authenticated', 'public.vendor_bookings', 'UPDATE') AS booking_update,
          has_any_column_privilege('authenticated', 'public.vendor_reviews', 'INSERT') AS review_insert,
          has_any_column_privilege('authenticated', 'public.vendor_reviews', 'UPDATE') AS review_update,
          has_any_column_privilege('authenticated', 'public.community_profiles', 'INSERT') AS community_profile_insert,
          has_any_column_privilege('authenticated', 'public.community_profiles', 'UPDATE') AS community_profile_update,
          has_any_column_privilege('authenticated', 'public.community_posts', 'INSERT') AS post_insert,
          has_any_column_privilege('authenticated', 'public.community_posts', 'UPDATE') AS post_update,
          has_table_privilege('authenticated', 'public.community_posts', 'DELETE') AS post_delete
      `);

      expect(privileges.rows[0]).toEqual({
        profile_insert: false,
        profile_admin_insert: false,
        profile_admin_update: false,
        profile_push_update: true,
        vendor_insert: false,
        vendor_update: false,
        vendor_delete: false,
        booking_insert: false,
        booking_update: false,
        review_insert: false,
        review_update: false,
        community_profile_insert: false,
        community_profile_update: false,
        post_insert: false,
        post_update: false,
        post_delete: false,
      });

      const writePolicies = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM pg_policy AS policy
        WHERE policy.polrelid IN (
          'public.profiles'::regclass,
          'public.vendors'::regclass,
          'public.vendor_bookings'::regclass,
          'public.vendor_reviews'::regclass,
          'public.community_profiles'::regclass,
          'public.community_posts'::regclass
        )
          AND policy.polcmd IN ('*', 'a', 'w', 'd')
          AND (
            policy.polname <> 'profiles_update_own'
          )
      `);
      expect(writePolicies.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects every direct trusted-field exploit while preserving push-token writes", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);
      await setPersona(db, "authenticated", USER_ID);

      await expect(
        db.exec(`INSERT INTO public.profiles (id, is_admin)
          VALUES ('60000000-0000-4000-8000-000000000001', true)`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`UPDATE public.profiles SET is_admin = true WHERE id = '${USER_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`UPDATE public.profiles
          SET push_token = 'ExponentPushToken[trusted-device]'
          WHERE id = '${USER_ID}'`),
      ).resolves.toBeDefined();

      await expect(
        db.exec(`UPDATE public.vendors
          SET status = 'approved', is_verified = true, ai_recommend = true,
              rating = 5, review_count = 500
          WHERE id = '${VENDOR_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`DELETE FROM public.vendors WHERE id = '${VENDOR_ID}'`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`UPDATE public.vendor_bookings
          SET status = 'completed', payment_status = 'paid', actual_amount = 1
          WHERE id = '${BOOKING_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`INSERT INTO public.vendor_reviews (
          id, vendor_id, booking_id, customer_id, rating, content
        ) VALUES (
          '60000000-0000-4000-8000-000000000002', '${VENDOR_ID}',
          '${BOOKING_ID}', '${USER_ID}', 5, 'forged'
        )`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`UPDATE public.vendor_reviews
          SET rating = 5, content = 'rewritten', reply = 'vendor reply', is_visible = false
          WHERE id = '${REVIEW_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`UPDATE public.community_profiles
          SET badge = 'admin', rank = 'senior', post_count = 999,
              warning_count = 0, is_suspended = false
          WHERE user_id = '${USER_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`UPDATE public.community_posts
          SET is_pinned = true, is_weekly_best = true,
              is_verified_review = true, under_review = false,
              upvote_count = 999
          WHERE id = '${POST_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`UPDATE public.community_posts SET title = 'Bypassed API'
          WHERE id = '${POST_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`DELETE FROM public.community_posts WHERE id = '${POST_ID}'`),
      ).rejects.toThrow(/permission denied|row-level security/i);

      await resetPersona(db);
      const state = await db.query<{
        is_admin: boolean;
        push_token: string | null;
        vendor_status: string;
        post_title: string;
      }>(`
        SELECT
          (SELECT is_admin FROM public.profiles WHERE id = '${USER_ID}') AS is_admin,
          (SELECT push_token FROM public.profiles WHERE id = '${USER_ID}') AS push_token,
          (SELECT status FROM public.vendors WHERE id = '${VENDOR_ID}') AS vendor_status,
          (SELECT title FROM public.community_posts WHERE id = '${POST_ID}') AS post_title
      `);
      expect(state.rows[0]).toEqual({
        is_admin: false,
        push_token: "ExponentPushToken[trusted-device]",
        vendor_status: "pending",
        post_title: "Title",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps service-owned canonical writes working and is replay-safe", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);
      await applyMigration(db);
      await setPersona(db, "service_role");

      await expect(
        db.exec(`UPDATE public.profiles SET is_admin = true WHERE id = '${USER_ID}'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`INSERT INTO public.vendors (id, owner_id, name)
          VALUES ('70000000-0000-4000-8000-000000000001', '${USER_ID}', 'Disposable')`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`DELETE FROM public.vendors
          WHERE id = '70000000-0000-4000-8000-000000000001'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`UPDATE public.vendors
          SET status = 'approved', is_verified = true, ai_recommend = true,
              rating = 4.8, review_count = 12
          WHERE id = '${VENDOR_ID}'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`UPDATE public.vendor_bookings
          SET status = 'completed', actual_amount = 650000, payment_status = 'paid'
          WHERE id = '${BOOKING_ID}'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`UPDATE public.vendor_reviews
          SET reply = 'Thanks', replied_at = now(), is_visible = true
          WHERE id = '${REVIEW_ID}'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`UPDATE public.community_profiles
          SET rank = 'senior', post_count = 10 WHERE user_id = '${USER_ID}'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`UPDATE public.community_posts
          SET title = 'Edited through API', is_pinned = true,
              is_weekly_best = true, upvote_count = 25
          WHERE id = '${POST_ID}'`),
      ).resolves.toBeDefined();

      const state = await db.query<Record<string, unknown>>(`
        SELECT
          (SELECT is_admin FROM public.profiles WHERE id = '${USER_ID}') AS is_admin,
          (SELECT status FROM public.vendors WHERE id = '${VENDOR_ID}') AS vendor_status,
          (SELECT status FROM public.vendor_bookings WHERE id = '${BOOKING_ID}') AS booking_status,
          (SELECT reply FROM public.vendor_reviews WHERE id = '${REVIEW_ID}') AS review_reply,
          (SELECT rank FROM public.community_profiles WHERE user_id = '${USER_ID}') AS community_rank,
          (SELECT title FROM public.community_posts WHERE id = '${POST_ID}') AS post_title,
          (SELECT is_pinned FROM public.community_posts WHERE id = '${POST_ID}') AS post_pinned
      `);
      expect(state.rows[0]).toEqual({
        is_admin: true,
        vendor_status: "approved",
        booking_status: "completed",
        review_reply: "Thanks",
        community_rank: "senior",
        post_title: "Edited through API",
        post_pinned: true,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
