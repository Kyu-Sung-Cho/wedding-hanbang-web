// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802121000_close_direct_mutation_bypasses.sql",
  ),
  "utf8",
);

const messageRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/messages/route.ts"),
  "utf8",
);
const commentRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/comments/route.ts"),
  "utf8",
);
const commentItemRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/comments/[id]/route.ts"),
  "utf8",
);
const reportRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/posts/[id]/report/route.ts"),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const THIRD_USER_ID = "00000000-0000-4000-8000-000000000003";
const FOURTH_USER_ID = "00000000-0000-4000-8000-000000000004";
const POST_ID = "10000000-0000-4000-8000-000000000001";
const DRAFT_POST_ID = "10000000-0000-4000-8000-000000000002";
const SELF_POST_ID = "10000000-0000-4000-8000-000000000003";
const COMMENT_ID = "20000000-0000-4000-8000-000000000001";
const CHILD_COMMENT_ID = "20000000-0000-4000-8000-000000000002";
const VENDOR_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const MEMBER_ROOM_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_ROOM_ID = "50000000-0000-4000-8000-000000000002";
const INACTIVE_ROOM_ID = "50000000-0000-4000-8000-000000000003";
const MEMBER_CONTRACT_ID = "60000000-0000-4000-8000-000000000001";
const INACTIVE_CONTRACT_ID = "60000000-0000-4000-8000-000000000002";
const COHORT_MESSAGE_ID = "61000000-0000-4000-8000-000000000001";
const POLL_ID = "70000000-0000-4000-8000-000000000001";
const OTHER_POLL_ID = "70000000-0000-4000-8000-000000000002";
const OPTION_ID = "80000000-0000-4000-8000-000000000001";
const OTHER_OPTION_ID = "80000000-0000-4000-8000-000000000002";
const GUESTBOOK_ID = "81000000-0000-4000-8000-000000000001";

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

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false,
      upvote_count integer NOT NULL DEFAULT 0,
      downvote_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      author_id uuid NOT NULL,
      content text NOT NULL,
      upvote_count integer NOT NULL DEFAULT 0,
      is_deleted boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_votes (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
      comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      vote_type smallint NOT NULL,
      CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL)
        OR (post_id IS NULL AND comment_id IS NOT NULL)
      ),
      UNIQUE (user_id, post_id),
      UNIQUE (user_id, comment_id)
    );
    CREATE TABLE public.community_reports (
      id uuid PRIMARY KEY,
      reporter_id uuid NOT NULL,
      post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
      comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      reason text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL)
        OR (post_id IS NULL AND comment_id IS NOT NULL)
      )
    );

    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id)
    );
    CREATE TABLE public.vendor_messages (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL,
      sender_type text NOT NULL,
      content text NOT NULL,
      is_read boolean NOT NULL DEFAULT false,
      booking_id uuid REFERENCES public.vendor_bookings(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.guestbooks (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL
    );
    CREATE TABLE public.guestbook_messages (
      id uuid PRIMARY KEY,
      guestbook_id uuid NOT NULL REFERENCES public.guestbooks(id) ON DELETE CASCADE,
      guest_name text NOT NULL,
      message text NOT NULL,
      is_approved boolean DEFAULT true,
      ip_hash text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY,
      room_id uuid NOT NULL,
      user_id uuid NOT NULL,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.cohort_contracts (
      id uuid PRIMARY KEY,
      room_id uuid NOT NULL,
      user_id uuid NOT NULL,
      vendor_name text NOT NULL,
      category text NOT NULL,
      base_price integer,
      extra_price integer,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.cohort_timeline_events (
      id uuid PRIMARY KEY,
      room_id uuid NOT NULL,
      user_id uuid NOT NULL,
      event_type text NOT NULL,
      description text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY,
      room_id uuid NOT NULL,
      author_id uuid NOT NULL,
      content text NOT NULL,
      thread_topic text,
      images text[] NOT NULL DEFAULT '{}',
      reply_to uuid REFERENCES public.cohort_messages(id) ON DELETE SET NULL,
      is_deleted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE FUNCTION public.is_cohort_member(p_room_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT COALESCE(auth.role(), '') = 'service_role'
        OR EXISTS (
          SELECT 1
          FROM public.cohort_members AS member
          WHERE member.room_id = p_room_id
            AND member.user_id = auth.uid()
            AND member.is_active = true
        )
    $$;
    GRANT EXECUTE ON FUNCTION public.is_cohort_member(uuid)
      TO authenticated, service_role;

    CREATE TABLE public.community_polls (
      id uuid PRIMARY KEY
    );
    CREATE TABLE public.community_poll_options (
      id uuid PRIMARY KEY,
      poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
      label text NOT NULL
    );
    CREATE TABLE public.community_poll_votes (
      id uuid PRIMARY KEY,
      poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
      option_id uuid NOT NULL REFERENCES public.community_poll_options(id) ON DELETE CASCADE,
      user_id uuid NOT NULL,
      UNIQUE (option_id, user_id)
    );

    CREATE FUNCTION public.community_vote_post(
      p_user_id uuid,
      p_post_id uuid,
      p_vote_type smallint
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'forbidden';
      END IF;
      IF p_vote_type = 0 THEN
        DELETE FROM public.community_votes
        WHERE user_id = p_user_id AND post_id = p_post_id;
      ELSE
        INSERT INTO public.community_votes (id, user_id, post_id, vote_type)
        VALUES ('d0000000-0000-4000-8000-000000000001', p_user_id, p_post_id, p_vote_type)
        ON CONFLICT (user_id, post_id) DO UPDATE SET vote_type = EXCLUDED.vote_type;
        UPDATE public.community_posts
        SET upvote_count = 1
        WHERE id = p_post_id;
      END IF;
    END;
    $$;
    CREATE FUNCTION public.community_vote_comment(
      p_user_id uuid,
      p_comment_id uuid,
      p_vote_type smallint
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'forbidden';
      END IF;
      IF p_vote_type = 0 THEN
        DELETE FROM public.community_votes
        WHERE user_id = p_user_id AND comment_id = p_comment_id;
      ELSE
        INSERT INTO public.community_votes (id, user_id, comment_id, vote_type)
        VALUES ('d0000000-0000-4000-8000-000000000002', p_user_id, p_comment_id, p_vote_type)
        ON CONFLICT (user_id, comment_id) DO UPDATE SET vote_type = EXCLUDED.vote_type;
      END IF;
    END;
    $$;
    CREATE FUNCTION public.community_cast_poll_vote(
      p_poll_id uuid,
      p_option_id uuid,
      p_user_id uuid
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      INSERT INTO public.community_poll_votes (id, poll_id, option_id, user_id)
      VALUES ('d0000000-0000-4000-8000-000000000003', p_poll_id, p_option_id, p_user_id);
      RETURN jsonb_build_object('ok', true);
    END;
    $$;
    REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.community_vote_post(uuid, uuid, smallint) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid) TO service_role;

    ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_votes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_poll_votes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.guestbook_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cohort_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cohort_contracts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cohort_timeline_events ENABLE ROW LEVEL SECURITY;

    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.community_reports,
      public.vendor_messages,
      public.community_comments,
      public.community_votes,
      public.community_poll_votes,
      public.guestbook_messages,
      public.cohort_messages,
      public.cohort_contracts,
      public.cohort_timeline_events
    TO authenticated;
    GRANT ALL ON TABLE
      public.community_posts,
      public.community_reports,
      public.vendor_messages,
      public.community_comments,
      public.community_votes,
      public.community_poll_votes,
      public.guestbook_messages,
      public.cohort_messages,
      public.cohort_contracts,
      public.cohort_timeline_events,
      public.community_poll_options
    TO service_role;
    GRANT SELECT, INSERT ON TABLE public.guestbook_messages TO anon;
    GRANT SELECT ON TABLE public.guestbooks TO authenticated;

    CREATE POLICY community_reports_select_own ON public.community_reports
      FOR SELECT TO authenticated USING (reporter_id = auth.uid());
    CREATE POLICY cr_insert ON public.community_reports
      FOR INSERT WITH CHECK (reporter_id = auth.uid());
    CREATE POLICY community_reports_insert_own ON public.community_reports
      FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
    CREATE POLICY community_reports_service_role_all ON public.community_reports
      FOR ALL TO service_role USING (true) WITH CHECK (true);

    CREATE POLICY vendor_messages_select ON public.vendor_messages
      FOR SELECT USING (customer_id = auth.uid());
    CREATE POLICY vendor_messages_insert ON public.vendor_messages
      FOR INSERT WITH CHECK (customer_id = auth.uid());
    CREATE POLICY vendor_messages_update ON public.vendor_messages
      FOR UPDATE USING (customer_id = auth.uid());

    CREATE POLICY cc_select ON public.community_comments FOR SELECT USING (true);
    CREATE POLICY cc_insert ON public.community_comments
      FOR INSERT WITH CHECK (author_id = auth.uid());
    CREATE POLICY cc_update ON public.community_comments
      FOR UPDATE USING (author_id = auth.uid());
    CREATE POLICY cc_delete ON public.community_comments
      FOR DELETE USING (author_id = auth.uid());

    CREATE POLICY cv_select ON public.community_votes
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY cv_insert ON public.community_votes
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY cv_update ON public.community_votes
      FOR UPDATE USING (user_id = auth.uid());
    CREATE POLICY cv_delete ON public.community_votes
      FOR DELETE USING (user_id = auth.uid());

    CREATE POLICY poll_votes_select_own ON public.community_poll_votes
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY poll_votes_insert_own ON public.community_poll_votes
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY poll_votes_delete_own ON public.community_poll_votes
      FOR DELETE USING (user_id = auth.uid());

    CREATE POLICY gb_messages_select ON public.guestbook_messages
      FOR SELECT USING (is_approved = true);
    CREATE POLICY gb_messages_insert_anon ON public.guestbook_messages
      FOR INSERT WITH CHECK (true);
    CREATE POLICY gb_messages_owner_update ON public.guestbook_messages
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM public.guestbooks AS guestbook
          WHERE guestbook.id = guestbook_id AND guestbook.owner_id = auth.uid()
        )
      );
    CREATE POLICY gb_messages_owner_delete ON public.guestbook_messages
      FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM public.guestbooks AS guestbook
          WHERE guestbook.id = guestbook_id AND guestbook.owner_id = auth.uid()
        )
      );

    CREATE POLICY cohort_messages_select ON public.cohort_messages
      FOR SELECT USING (public.is_cohort_member(room_id));
    CREATE POLICY cohort_messages_insert ON public.cohort_messages
      FOR INSERT WITH CHECK (
        author_id = auth.uid() AND public.is_cohort_member(room_id)
      );
    CREATE POLICY cohort_messages_update ON public.cohort_messages
      FOR UPDATE USING (author_id = auth.uid());
    CREATE POLICY cohort_messages_delete ON public.cohort_messages
      FOR DELETE USING (author_id = auth.uid());

    CREATE POLICY cohort_contracts_select_own ON public.cohort_contracts
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY cohort_contracts_insert ON public.cohort_contracts
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY cohort_contracts_update ON public.cohort_contracts
      FOR UPDATE USING (user_id = auth.uid());
    CREATE POLICY cohort_contracts_delete ON public.cohort_contracts
      FOR DELETE USING (user_id = auth.uid());
    CREATE POLICY cohort_timeline_select ON public.cohort_timeline_events
      FOR SELECT USING (true);
    CREATE POLICY cohort_timeline_insert ON public.cohort_timeline_events
      FOR INSERT WITH CHECK (user_id = auth.uid());

    INSERT INTO public.community_posts (
      id, author_id, visibility, under_review, comment_count
    ) VALUES
      ('${POST_ID}', '${OTHER_USER_ID}', 'public', false, 2),
      ('${DRAFT_POST_ID}', '${OTHER_USER_ID}', 'draft', false, 0),
      ('${SELF_POST_ID}', '${USER_ID}', 'public', false, 0);
    INSERT INTO public.community_comments (
      id, post_id, parent_id, author_id, content
    ) VALUES
      ('${COMMENT_ID}', '${POST_ID}', NULL, '${USER_ID}', 'comment'),
      ('${CHILD_COMMENT_ID}', '${POST_ID}', '${COMMENT_ID}', '${OTHER_USER_ID}', 'reply');

    INSERT INTO public.vendors (id, owner_id)
    VALUES ('${VENDOR_ID}', '${OTHER_USER_ID}');
    INSERT INTO public.guestbooks (id, owner_id)
    VALUES ('${GUESTBOOK_ID}', '${USER_ID}');
    INSERT INTO public.vendor_messages (
      id, vendor_id, customer_id, sender_type, content, is_read
    ) VALUES (
      '${MESSAGE_ID}', '${VENDOR_ID}', '${USER_ID}', 'customer', 'hello', false
    );

    INSERT INTO public.cohort_members (id, room_id, user_id, is_active) VALUES
      ('90000000-0000-4000-8000-000000000001', '${MEMBER_ROOM_ID}', '${USER_ID}', true),
      ('90000000-0000-4000-8000-000000000002', '${INACTIVE_ROOM_ID}', '${USER_ID}', false);
    INSERT INTO public.cohort_messages (
      id, room_id, author_id, content
    ) VALUES (
      '${COHORT_MESSAGE_ID}', '${MEMBER_ROOM_ID}', '${USER_ID}', 'existing message'
    );
    INSERT INTO public.cohort_contracts (
      id, room_id, user_id, vendor_name, category, base_price
    ) VALUES
      ('${MEMBER_CONTRACT_ID}', '${MEMBER_ROOM_ID}', '${USER_ID}', 'member vendor', 'venue', 100),
      ('${INACTIVE_CONTRACT_ID}', '${INACTIVE_ROOM_ID}', '${USER_ID}', 'old vendor', 'venue', 100);

    INSERT INTO public.community_polls (id)
    VALUES ('${POLL_ID}'), ('${OTHER_POLL_ID}');
    INSERT INTO public.community_poll_options (id, poll_id, label) VALUES
      ('${OPTION_ID}', '${POLL_ID}', 'one'),
      ('${OTHER_OPTION_ID}', '${OTHER_POLL_ID}', 'two');
  `);
  return db;
}

async function applyMigration(db: PGlite) {
  await db.exec(migration);
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
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

describe("direct mutation bypass fence migration", () => {
  it("routes fenced writes through validated server boundaries", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:guestbook_messages|cohort_messages)\b/i,
    );
    expect(messageRoute).toContain("const { data: message, error } = await serviceClient");
    expect(messageRoute).toContain("export async function PATCH(req: Request)");
    expect(messageRoute).toContain('rateLimitKey("messages:mark-read"');
    expect(messageRoute).toContain("isTrustedMutationRequest(req)");
    expect(messageRoute).not.toContain("const unreadIds");
    expect(commentItemRoute).toContain(
      "const { data: updatedComment, error } = await getServiceClient()",
    );
    expect(commentRoute).toContain('.rpc("community_create_comment_atomic"');
    expect(commentRoute).not.toMatch(
      /\.from\("community_comments"\)[\s\S]{0,200}?\.insert\(/,
    );
    expect(reportRoute).toContain(
      '.select("author_id, visibility, under_review")',
    );
    expect(reportRoute).toContain("targetPost.author_id === user.id");
  });

  it("removes direct table mutations while preserving canonical roles", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);

      const privileges = await db.query<Record<string, boolean>>(`
        SELECT
          has_any_column_privilege('authenticated', 'public.community_reports', 'INSERT') AS report_insert,
          has_table_privilege('authenticated', 'public.community_reports', 'DELETE') AS report_delete,
          has_any_column_privilege('authenticated', 'public.vendor_messages', 'INSERT') AS message_insert,
          has_any_column_privilege('authenticated', 'public.vendor_messages', 'UPDATE') AS message_update,
          has_any_column_privilege('authenticated', 'public.community_comments', 'INSERT') AS comment_insert,
          has_any_column_privilege('authenticated', 'public.community_comments', 'UPDATE') AS comment_update,
          has_table_privilege('authenticated', 'public.community_comments', 'DELETE') AS comment_delete,
          has_any_column_privilege('authenticated', 'public.cohort_messages', 'INSERT') AS cohort_message_insert,
          has_any_column_privilege('authenticated', 'public.cohort_messages', 'UPDATE') AS cohort_message_update,
          has_table_privilege('authenticated', 'public.cohort_messages', 'DELETE') AS cohort_message_delete,
          has_any_column_privilege('authenticated', 'public.community_votes', 'INSERT') AS vote_insert,
          has_any_column_privilege('authenticated', 'public.community_votes', 'UPDATE') AS vote_update,
          has_table_privilege('authenticated', 'public.community_votes', 'DELETE') AS vote_delete,
          has_any_column_privilege('authenticated', 'public.community_poll_votes', 'INSERT') AS poll_insert,
          has_table_privilege('authenticated', 'public.community_poll_votes', 'DELETE') AS poll_delete,
          has_any_column_privilege('authenticated', 'public.guestbook_messages', 'INSERT') AS guestbook_insert,
          has_any_column_privilege('anon', 'public.guestbook_messages', 'INSERT') AS anon_guestbook_insert,
          has_table_privilege('authenticated', 'public.cohort_contracts', 'INSERT') AS contract_insert,
          has_table_privilege('authenticated', 'public.cohort_timeline_events', 'INSERT') AS timeline_insert,
          has_table_privilege('service_role', 'public.community_reports', 'INSERT') AS service_report_insert,
          has_table_privilege('service_role', 'public.vendor_messages', 'UPDATE') AS service_message_update,
          has_table_privilege('service_role', 'public.community_comments', 'DELETE') AS service_comment_delete,
          has_table_privilege('service_role', 'public.cohort_messages', 'DELETE') AS service_cohort_message_delete,
          has_table_privilege('service_role', 'public.community_votes', 'INSERT') AS service_vote_insert,
          has_table_privilege('service_role', 'public.community_poll_votes', 'INSERT') AS service_poll_insert,
          has_table_privilege('service_role', 'public.guestbook_messages', 'INSERT') AS service_guestbook_insert
      `);

      expect(privileges.rows[0]).toEqual({
        report_insert: false,
        report_delete: false,
        message_insert: false,
        message_update: false,
        comment_insert: false,
        comment_update: false,
        comment_delete: false,
        cohort_message_insert: false,
        cohort_message_update: false,
        cohort_message_delete: false,
        vote_insert: false,
        vote_update: false,
        vote_delete: false,
        poll_insert: false,
        poll_delete: false,
        guestbook_insert: false,
        anon_guestbook_insert: false,
        contract_insert: true,
        timeline_insert: true,
        service_report_insert: true,
        service_message_update: true,
        service_comment_delete: true,
        service_cohort_message_delete: true,
        service_vote_insert: true,
        service_poll_insert: true,
        service_guestbook_insert: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects direct spoofing/deletion and cross-room writes", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);
      await setPersona(db, "authenticated", USER_ID);

      await expect(
        db.exec(`INSERT INTO public.community_reports (
          id, reporter_id, post_id, reason
        ) VALUES (
          'a0000000-0000-4000-8000-000000000001', '${USER_ID}', '${POST_ID}', 'spam'
        )`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`INSERT INTO public.vendor_messages (
          id, vendor_id, customer_id, sender_type, content, is_read
        ) VALUES (
          'a0000000-0000-4000-8000-000000000002', '${VENDOR_ID}',
          '${USER_ID}', 'vendor', 'forged', true
        )`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`UPDATE public.vendor_messages
          SET sender_type = 'vendor', customer_id = '${OTHER_USER_ID}', is_read = true
          WHERE id = '${MESSAGE_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`UPDATE public.community_comments
          SET post_id = '${SELF_POST_ID}', parent_id = NULL,
              upvote_count = 999, is_deleted = true
          WHERE id = '${COMMENT_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`DELETE FROM public.community_comments WHERE id = '${COMMENT_ID}'`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`INSERT INTO public.cohort_messages (
          id, room_id, author_id, content, is_deleted, created_at
        ) VALUES (
          'a2000000-0000-4000-8000-000000000001', '${MEMBER_ROOM_ID}',
          '${USER_ID}', '${"x".repeat(2100)}', false, '2000-01-01T00:00:00Z'
        )`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`UPDATE public.cohort_messages
          SET room_id = '${OTHER_ROOM_ID}', is_deleted = true,
              created_at = '2000-01-01T00:00:00Z'
          WHERE id = '${COHORT_MESSAGE_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`DELETE FROM public.cohort_messages
          WHERE id = '${COHORT_MESSAGE_ID}'`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`INSERT INTO public.community_votes (
          id, user_id, post_id, vote_type
        ) VALUES (
          'a0000000-0000-4000-8000-000000000008', '${USER_ID}', '${POST_ID}', 1
        )`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`INSERT INTO public.community_poll_votes (
          id, poll_id, option_id, user_id
        ) VALUES (
          'a0000000-0000-4000-8000-000000000003', '${POLL_ID}',
          '${OPTION_ID}', '${USER_ID}'
        )`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await expect(
        db.exec(`INSERT INTO public.guestbook_messages (
          id, guestbook_id, guest_name, message
        ) VALUES (
          'a1000000-0000-4000-8000-000000000001', '${GUESTBOOK_ID}',
          'attacker', 'instant public spam'
        )`),
      ).rejects.toThrow(/permission denied|row-level security/i);

      await expect(
        db.exec(`INSERT INTO public.cohort_contracts (
          id, room_id, user_id, vendor_name, category, base_price
        ) VALUES (
          'a0000000-0000-4000-8000-000000000004', '${OTHER_ROOM_ID}',
          '${USER_ID}', 'forged room', 'venue', 1
        )`),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        db.exec(`INSERT INTO public.cohort_timeline_events (
          id, room_id, user_id, event_type
        ) VALUES (
          'a0000000-0000-4000-8000-000000000005', '${OTHER_ROOM_ID}',
          '${USER_ID}', 'contract_done'
        )`),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        db.exec(`UPDATE public.cohort_contracts
          SET room_id = '${OTHER_ROOM_ID}' WHERE id = '${MEMBER_CONTRACT_ID}'`),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        db.exec(`DELETE FROM public.cohort_contracts
          WHERE id = '${INACTIVE_CONTRACT_ID}'`),
      ).resolves.toBeDefined();

      // The atomic RPC remains callable after table DML is removed.
      await expect(
        db.exec(`SELECT public.community_vote_post(
          '${USER_ID}', '${POST_ID}', 1::smallint
        )`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`SELECT public.community_vote_post(
          '${USER_ID}', '${DRAFT_POST_ID}', 1::smallint
        )`),
      ).rejects.toThrow(/vote_target_not_accessible/i);
      await expect(
        db.exec(`UPDATE public.community_votes SET vote_type = -1
          WHERE user_id = '${USER_ID}' AND post_id = '${POST_ID}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.exec(`DELETE FROM public.community_votes
          WHERE user_id = '${USER_ID}' AND post_id = '${POST_ID}'`),
      ).rejects.toThrow(/permission denied|row-level security/i);

      await expect(
        db.exec(`INSERT INTO public.cohort_contracts (
          id, room_id, user_id, vendor_name, category, base_price
        ) VALUES (
          'a0000000-0000-4000-8000-000000000006', '${MEMBER_ROOM_ID}',
          '${USER_ID}', 'allowed room', 'venue', 100
        )`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`INSERT INTO public.cohort_timeline_events (
          id, room_id, user_id, event_type
        ) VALUES (
          'a0000000-0000-4000-8000-000000000007', '${MEMBER_ROOM_ID}',
          '${USER_ID}', 'contract_done'
        )`),
      ).resolves.toBeDefined();

      await resetPersona(db);
      await setPersona(db, "anon");
      await expect(
        db.exec(`INSERT INTO public.guestbook_messages (
          id, guestbook_id, guest_name, message
        ) VALUES (
          'a1000000-0000-4000-8000-000000000002', '${GUESTBOOK_ID}',
          'anonymous attacker', 'instant public spam'
        )`),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await resetPersona(db);
      const state = await db.query<{
        child_count: number;
        inactive_contract_count: number;
        vote_count: number;
        post_upvotes: number;
        guestbook_message_count: number;
        cohort_message_count: number;
        cohort_message_deleted: boolean;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.community_comments
            WHERE id = '${CHILD_COMMENT_ID}') AS child_count,
          (SELECT count(*)::integer FROM public.cohort_contracts
            WHERE id = '${INACTIVE_CONTRACT_ID}') AS inactive_contract_count,
          (SELECT count(*)::integer FROM public.community_votes
            WHERE user_id = '${USER_ID}' AND post_id = '${POST_ID}') AS vote_count,
          (SELECT upvote_count FROM public.community_posts
            WHERE id = '${POST_ID}') AS post_upvotes,
          (SELECT count(*)::integer FROM public.guestbook_messages
            WHERE guestbook_id = '${GUESTBOOK_ID}') AS guestbook_message_count,
          (SELECT count(*)::integer FROM public.cohort_messages
            WHERE id = '${COHORT_MESSAGE_ID}') AS cohort_message_count,
          (SELECT is_deleted FROM public.cohort_messages
            WHERE id = '${COHORT_MESSAGE_ID}') AS cohort_message_deleted
      `);
      expect(state.rows[0]).toEqual({
        child_count: 1,
        inactive_contract_count: 1,
        vote_count: 1,
        post_upvotes: 1,
        guestbook_message_count: 0,
        cohort_message_count: 1,
        cohort_message_deleted: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("enforces report uniqueness/access and poll option ownership for service writes", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);
      await applyMigration(db);
      await setPersona(db, "service_role");

      await expect(
        db.exec(`INSERT INTO public.guestbook_messages (
          id, guestbook_id, guest_name, message, is_approved
        ) VALUES (
          'b1000000-0000-4000-8000-000000000001', '${GUESTBOOK_ID}',
          'moderated guest', 'approved by canonical service', true
        )`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`INSERT INTO public.cohort_messages (
          id, room_id, author_id, content
        ) VALUES (
          'b2000000-0000-4000-8000-000000000001', '${MEMBER_ROOM_ID}',
          '${USER_ID}', 'validated API message'
        )`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`UPDATE public.cohort_messages SET is_deleted = true
          WHERE id = 'b2000000-0000-4000-8000-000000000001'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`DELETE FROM public.cohort_messages
          WHERE id = 'b2000000-0000-4000-8000-000000000001'`),
      ).resolves.toBeDefined();

      await expect(
        db.exec(`INSERT INTO public.community_reports (
          id, reporter_id, post_id, reason, status
        ) VALUES (
          'b0000000-0000-4000-8000-000000000001', '${USER_ID}',
          '${POST_ID}', 'spam', 'pending'
        )`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`INSERT INTO public.community_reports (
          id, reporter_id, post_id, reason, status
        ) VALUES (
          'b0000000-0000-4000-8000-000000000002', '${USER_ID}',
          '${POST_ID}', 'abuse', 'dismissed'
        )`),
      ).rejects.toThrow(/unique|duplicate/i);
      await expect(
        db.exec(`INSERT INTO public.community_reports (
          id, reporter_id, post_id, reason
        ) VALUES (
          'b0000000-0000-4000-8000-000000000003', '${OTHER_USER_ID}',
          '${POST_ID}', 'spam'
        )`),
      ).rejects.toThrow(/self_report_not_allowed/i);
      await expect(
        db.exec(`INSERT INTO public.community_reports (
          id, reporter_id, post_id, reason
        ) VALUES (
          'b0000000-0000-4000-8000-000000000004', '${USER_ID}',
          '${DRAFT_POST_ID}', 'spam'
        )`),
      ).rejects.toThrow(/report_target_not_accessible/i);

      await db.exec(`INSERT INTO public.community_reports (
        id, reporter_id, post_id, reason, status
      ) VALUES
        ('b0000000-0000-4000-8000-000000000005', '${THIRD_USER_ID}', '${POST_ID}', 'spam', 'pending'),
        ('b0000000-0000-4000-8000-000000000006', '${FOURTH_USER_ID}', '${POST_ID}', 'spam', 'pending')`);

      const post = await db.query<{ under_review: boolean }>(`
        SELECT under_review FROM public.community_posts WHERE id = '${POST_ID}'
      `);
      expect(post.rows[0]?.under_review).toBe(true);

      await expect(
        db.exec(`INSERT INTO public.community_poll_votes (
          id, poll_id, option_id, user_id
        ) VALUES (
          'b0000000-0000-4000-8000-000000000007', '${POLL_ID}',
          '${OTHER_OPTION_ID}', '${USER_ID}'
        )`),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        db.exec(`INSERT INTO public.community_poll_votes (
          id, poll_id, option_id, user_id
        ) VALUES (
          'b0000000-0000-4000-8000-000000000008', '${POLL_ID}',
          '${OPTION_ID}', '${USER_ID}'
        )`),
      ).resolves.toBeDefined();

      await expect(
        db.exec(`UPDATE public.vendor_messages SET is_read = true WHERE id = '${MESSAGE_ID}'`),
      ).resolves.toBeDefined();
      await expect(
        db.exec(`UPDATE public.community_comments
          SET content = 'deleted', is_deleted = true WHERE id = '${COMMENT_ID}'`),
      ).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed instead of silently rewriting historical integrity violations", async () => {
    const duplicateDb = await createDatabase();
    try {
      await duplicateDb.exec(`INSERT INTO public.community_reports (
        id, reporter_id, post_id, reason
      ) VALUES
        ('c0000000-0000-4000-8000-000000000001', '${USER_ID}', '${POST_ID}', 'spam'),
        ('c0000000-0000-4000-8000-000000000002', '${USER_ID}', '${POST_ID}', 'abuse')`);
      await expect(applyMigration(duplicateDb)).rejects.toThrow(
        /DUPLICATE_POST_REPORTS_REQUIRE_REVIEW/,
      );
    } finally {
      await duplicateDb.close();
    }

    const mismatchedVoteDb = await createDatabase();
    try {
      await mismatchedVoteDb.exec(`INSERT INTO public.community_poll_votes (
        id, poll_id, option_id, user_id
      ) VALUES (
        'c0000000-0000-4000-8000-000000000003', '${POLL_ID}',
        '${OTHER_OPTION_ID}', '${USER_ID}'
      )`);
      await expect(applyMigration(mismatchedVoteDb)).rejects.toThrow(
        /MISMATCHED_POLL_VOTES_REQUIRE_REVIEW/,
      );
    } finally {
      await mismatchedVoteDb.close();
    }
  }, 30_000);
});
