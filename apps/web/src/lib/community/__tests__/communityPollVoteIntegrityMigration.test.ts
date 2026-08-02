// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802149000_harden_community_poll_vote_integrity.sql",
  ),
  "utf8",
);

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";

const PUBLIC_POST_ID = "10000000-0000-4000-8000-000000000001";
const MULTI_POST_ID = "10000000-0000-4000-8000-000000000002";
const OTHER_DRAFT_POST_ID = "10000000-0000-4000-8000-000000000003";
const OWN_DRAFT_POST_ID = "10000000-0000-4000-8000-000000000004";
const OTHER_REVIEW_POST_ID = "10000000-0000-4000-8000-000000000005";
const OWN_REVIEW_POST_ID = "10000000-0000-4000-8000-000000000006";
const MEMBERS_POST_ID = "10000000-0000-4000-8000-000000000007";
const CLOSED_POST_ID = "10000000-0000-4000-8000-000000000008";

const SINGLE_POLL_ID = "20000000-0000-4000-8000-000000000001";
const MULTI_POLL_ID = "20000000-0000-4000-8000-000000000002";
const OTHER_DRAFT_POLL_ID = "20000000-0000-4000-8000-000000000003";
const OWN_DRAFT_POLL_ID = "20000000-0000-4000-8000-000000000004";
const OTHER_REVIEW_POLL_ID = "20000000-0000-4000-8000-000000000005";
const OWN_REVIEW_POLL_ID = "20000000-0000-4000-8000-000000000006";
const MEMBERS_POLL_ID = "20000000-0000-4000-8000-000000000007";
const CLOSED_POLL_ID = "20000000-0000-4000-8000-000000000008";
const MISSING_POLL_ID = "20000000-0000-4000-8000-000000000099";

const SINGLE_OPTION_A_ID = "30000000-0000-4000-8000-000000000001";
const SINGLE_OPTION_B_ID = "30000000-0000-4000-8000-000000000002";
const MULTI_OPTION_A_ID = "30000000-0000-4000-8000-000000000003";
const MULTI_OPTION_B_ID = "30000000-0000-4000-8000-000000000004";
const OTHER_DRAFT_OPTION_ID = "30000000-0000-4000-8000-000000000005";
const OWN_DRAFT_OPTION_ID = "30000000-0000-4000-8000-000000000006";
const OTHER_REVIEW_OPTION_ID = "30000000-0000-4000-8000-000000000007";
const OWN_REVIEW_OPTION_ID = "30000000-0000-4000-8000-000000000008";
const MEMBERS_OPTION_ID = "30000000-0000-4000-8000-000000000009";
const CLOSED_OPTION_ID = "30000000-0000-4000-8000-000000000010";
const MISSING_OPTION_ID = "30000000-0000-4000-8000-000000000099";

interface RpcResult {
  ok: boolean;
  error?: string;
  action?: "added" | "removed" | "switched";
}

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

    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.community_polls (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL UNIQUE
        REFERENCES public.community_posts(id) ON DELETE CASCADE,
      question text NOT NULL,
      allow_multiple boolean NOT NULL DEFAULT false,
      is_anonymous boolean NOT NULL DEFAULT false,
      hide_results_until_voted boolean NOT NULL DEFAULT false,
      closes_at timestamptz,
      total_voters integer NOT NULL DEFAULT 0,
      total_votes integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.community_poll_options (
      id uuid PRIMARY KEY,
      poll_id uuid NOT NULL
        REFERENCES public.community_polls(id) ON DELETE CASCADE,
      position integer NOT NULL,
      label text NOT NULL,
      image_url text,
      vote_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (poll_id, position),
      UNIQUE (id, poll_id)
    );

    CREATE TABLE public.community_poll_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id uuid NOT NULL
        REFERENCES public.community_polls(id) ON DELETE CASCADE,
      option_id uuid NOT NULL
        REFERENCES public.community_poll_options(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (option_id, user_id),
      CONSTRAINT community_poll_votes_option_poll_fkey
        FOREIGN KEY (option_id, poll_id)
        REFERENCES public.community_poll_options(id, poll_id)
        ON DELETE CASCADE
    );

    ALTER TABLE public.community_poll_votes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY poll_votes_select_own ON public.community_poll_votes
      FOR SELECT TO authenticated USING (user_id = auth.uid());
    CREATE POLICY poll_votes_insert_own ON public.community_poll_votes
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
    CREATE POLICY poll_votes_delete_own ON public.community_poll_votes
      FOR DELETE TO authenticated USING (user_id = auth.uid());

    CREATE FUNCTION public.community_poll_recount()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_poll_id uuid;
      v_option_id uuid;
    BEGIN
      v_poll_id := COALESCE(NEW.poll_id, OLD.poll_id);
      v_option_id := COALESCE(NEW.option_id, OLD.option_id);
      UPDATE public.community_poll_options
      SET vote_count = (
        SELECT count(*)::integer FROM public.community_poll_votes
        WHERE option_id = v_option_id
      )
      WHERE id = v_option_id;
      UPDATE public.community_polls
      SET total_votes = (
            SELECT count(*)::integer FROM public.community_poll_votes
            WHERE poll_id = v_poll_id
          ),
          total_voters = (
            SELECT count(DISTINCT user_id)::integer
            FROM public.community_poll_votes
            WHERE poll_id = v_poll_id
          )
      WHERE id = v_poll_id;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
    CREATE TRIGGER trg_poll_votes_recount
    AFTER INSERT OR DELETE ON public.community_poll_votes
    FOR EACH ROW EXECUTE FUNCTION public.community_poll_recount();

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
    DECLARE
      v_allow_multiple boolean;
      v_already_voted boolean;
    BEGIN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
      END IF;
      SELECT allow_multiple INTO v_allow_multiple
      FROM public.community_polls WHERE id = p_poll_id;
      SELECT EXISTS (
        SELECT 1 FROM public.community_poll_votes
        WHERE option_id = p_option_id AND user_id = p_user_id
      ) INTO v_already_voted;
      IF v_allow_multiple AND v_already_voted THEN
        DELETE FROM public.community_poll_votes
        WHERE option_id = p_option_id AND user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'action', 'removed');
      ELSIF v_allow_multiple THEN
        INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
        VALUES (p_poll_id, p_option_id, p_user_id);
        RETURN jsonb_build_object('ok', true, 'action', 'added');
      ELSIF v_already_voted THEN
        DELETE FROM public.community_poll_votes
        WHERE option_id = p_option_id AND user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'action', 'removed');
      END IF;
      DELETE FROM public.community_poll_votes
      WHERE poll_id = p_poll_id AND user_id = p_user_id;
      INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
      VALUES (p_poll_id, p_option_id, p_user_id);
      RETURN jsonb_build_object('ok', true, 'action', 'switched');
    END;
    $$;

    REVOKE ALL ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
      TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.community_poll_votes
      TO anon, authenticated, service_role;
    GRANT SELECT, UPDATE ON public.community_polls, public.community_poll_options
      TO service_role;

    INSERT INTO auth.users (id) VALUES ('${ACTOR_ID}'), ('${OTHER_ID}');
    INSERT INTO public.community_posts (id, author_id, visibility, under_review)
    VALUES
      ('${PUBLIC_POST_ID}', '${OTHER_ID}', 'public', false),
      ('${MULTI_POST_ID}', '${OTHER_ID}', 'public', false),
      ('${OTHER_DRAFT_POST_ID}', '${OTHER_ID}', 'draft', false),
      ('${OWN_DRAFT_POST_ID}', '${ACTOR_ID}', 'draft', false),
      ('${OTHER_REVIEW_POST_ID}', '${OTHER_ID}', 'public', true),
      ('${OWN_REVIEW_POST_ID}', '${ACTOR_ID}', 'public', true),
      ('${MEMBERS_POST_ID}', '${OTHER_ID}', 'members', false),
      ('${CLOSED_POST_ID}', '${OTHER_ID}', 'public', false);

    INSERT INTO public.community_polls (
      id, post_id, question, allow_multiple, closes_at,
      total_voters, total_votes
    ) VALUES
      ('${SINGLE_POLL_ID}', '${PUBLIC_POST_ID}', 'single', false, NULL, 99, 99),
      ('${MULTI_POLL_ID}', '${MULTI_POST_ID}', 'multi', true, NULL, 0, 0),
      ('${OTHER_DRAFT_POLL_ID}', '${OTHER_DRAFT_POST_ID}', 'draft', false, NULL, 0, 0),
      ('${OWN_DRAFT_POLL_ID}', '${OWN_DRAFT_POST_ID}', 'own draft', false, NULL, 0, 0),
      ('${OTHER_REVIEW_POLL_ID}', '${OTHER_REVIEW_POST_ID}', 'review', false, NULL, 0, 0),
      ('${OWN_REVIEW_POLL_ID}', '${OWN_REVIEW_POST_ID}', 'own review', false, NULL, 0, 0),
      ('${MEMBERS_POLL_ID}', '${MEMBERS_POST_ID}', 'members', false, NULL, 0, 0),
      ('${CLOSED_POLL_ID}', '${CLOSED_POST_ID}', 'closed', false, '2000-01-01', 0, 0);

    INSERT INTO public.community_poll_options (
      id, poll_id, position, label, vote_count
    ) VALUES
      ('${SINGLE_OPTION_A_ID}', '${SINGLE_POLL_ID}', 0, 'A', 99),
      ('${SINGLE_OPTION_B_ID}', '${SINGLE_POLL_ID}', 1, 'B', 99),
      ('${MULTI_OPTION_A_ID}', '${MULTI_POLL_ID}', 0, 'A', 0),
      ('${MULTI_OPTION_B_ID}', '${MULTI_POLL_ID}', 1, 'B', 0),
      ('${OTHER_DRAFT_OPTION_ID}', '${OTHER_DRAFT_POLL_ID}', 0, 'A', 0),
      ('${OWN_DRAFT_OPTION_ID}', '${OWN_DRAFT_POLL_ID}', 0, 'A', 0),
      ('${OTHER_REVIEW_OPTION_ID}', '${OTHER_REVIEW_POLL_ID}', 0, 'A', 0),
      ('${OWN_REVIEW_OPTION_ID}', '${OWN_REVIEW_POLL_ID}', 0, 'A', 0),
      ('${MEMBERS_OPTION_ID}', '${MEMBERS_POLL_ID}', 0, 'A', 0),
      ('${CLOSED_OPTION_ID}', '${CLOSED_POLL_ID}', 0, 'A', 0);

    INSERT INTO public.community_poll_votes (
      poll_id, option_id, user_id, created_at
    ) VALUES
      (
        '${SINGLE_POLL_ID}', '${SINGLE_OPTION_A_ID}', '${OTHER_ID}',
        '2026-08-01T00:00:00Z'
      ),
      (
        '${SINGLE_POLL_ID}', '${SINGLE_OPTION_B_ID}', '${OTHER_ID}',
        '2026-08-02T00:00:00Z'
      );
    UPDATE public.community_polls
    SET total_voters = 99, total_votes = 99
    WHERE id = '${SINGLE_POLL_ID}';
    UPDATE public.community_poll_options
    SET vote_count = 99
    WHERE poll_id = '${SINGLE_POLL_ID}';
  `);
  return db;
}

async function setClaims(
  db: PGlite,
  role: "authenticated" | "service_role" | "",
  userId = "",
) {
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
  userId = "",
) {
  await db.exec(`SET ROLE ${role}`);
  await setClaims(db, role, userId);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await setClaims(db, "");
}

async function castVote(
  db: PGlite,
  pollId: string,
  optionId: string,
  userId: string,
) {
  const result = await db.query<{ result: RpcResult }>(`
    SELECT public.community_cast_poll_vote(
      '${pollId}', '${optionId}', '${userId}'
    ) AS result
  `);
  return result.rows[0]?.result;
}

async function readPollCounts(db: PGlite, pollId: string) {
  return db.query<{
    total_voters: number;
    total_votes: number;
    actual_voters: number;
    actual_votes: number;
  }>(`
    SELECT
      poll.total_voters,
      poll.total_votes,
      count(DISTINCT vote.user_id)::integer AS actual_voters,
      count(vote.id)::integer AS actual_votes
    FROM public.community_polls AS poll
    LEFT JOIN public.community_poll_votes AS vote ON vote.poll_id = poll.id
    WHERE poll.id = '${pollId}'
    GROUP BY poll.id, poll.total_voters, poll.total_votes
  `);
}

describe("community poll vote integrity migration", () => {
  it("repairs historical single-choice duplicates and counters idempotently", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      const votes = await db.query<{ option_id: string }>(`
        SELECT option_id
        FROM public.community_poll_votes
        WHERE poll_id = '${SINGLE_POLL_ID}'
          AND user_id = '${OTHER_ID}'
      `);
      expect(votes.rows).toEqual([{ option_id: SINGLE_OPTION_B_ID }]);

      const options = await db.query<{ id: string; vote_count: number }>(`
        SELECT id, vote_count
        FROM public.community_poll_options
        WHERE poll_id = '${SINGLE_POLL_ID}'
        ORDER BY position
      `);
      expect(options.rows).toEqual([
        { id: SINGLE_OPTION_A_ID, vote_count: 0 },
        { id: SINGLE_OPTION_B_ID, vote_count: 1 },
      ]);
      expect((await readPollCounts(db, SINGLE_POLL_ID)).rows).toEqual([{
        total_voters: 1,
        total_votes: 1,
        actual_voters: 1,
        actual_votes: 1,
      }]);
    } finally {
      await db.close();
    }
  });

  it("installs the shared lock order and deferred cascade recount contract", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      const definitions = await db.query<{ proname: string; definition: string }>(`
        SELECT procedure.proname,
               pg_catalog.pg_get_functiondef(procedure.oid) AS definition
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'community_cast_poll_vote',
            'community_poll_vote_target_guard'
          )
        ORDER BY procedure.proname
      `);

      for (const { definition } of definitions.rows) {
        expect(definition).toMatch(/FROM auth\.users[\s\S]*FOR KEY SHARE/i);
        expect(definition).toMatch(/FROM public\.community_posts[\s\S]*FOR UPDATE/i);
        expect(definition).toMatch(/FROM public\.community_polls[\s\S]*FOR UPDATE/i);
        expect(definition).toMatch(/FROM public\.community_poll_options[\s\S]*FOR KEY SHARE/i);
      }

      const triggers = await db.query<{
        tgname: string;
        tgtype: number;
        tgdeferrable: boolean;
        tginitdeferred: boolean;
      }>(`
        SELECT tgname, tgtype, tgdeferrable, tginitdeferred
        FROM pg_catalog.pg_trigger
        WHERE tgname IN (
          'trg_community_poll_vote_target_guard',
          'trg_community_poll_vote_delete_recount',
          'trg_community_poll_mode_guard'
        )
        ORDER BY tgname
      `);
      expect(triggers.rows).toEqual([
        {
          tgname: "trg_community_poll_mode_guard",
          tgtype: 19,
          tgdeferrable: false,
          tginitdeferred: false,
        },
        {
          tgname: "trg_community_poll_vote_delete_recount",
          tgtype: 9,
          tgdeferrable: true,
          tginitdeferred: true,
        },
        {
          tgname: "trg_community_poll_vote_target_guard",
          tgtype: 23,
          tgdeferrable: false,
          tginitdeferred: false,
        },
      ]);
    } finally {
      await db.close();
    }
  });

  it("serially toggles and switches one single choice with exact counters", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      expect(await castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_A_ID, ACTOR_ID))
        .toEqual({ ok: true, action: "switched" });
      expect(await castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_B_ID, ACTOR_ID))
        .toEqual({ ok: true, action: "switched" });
      expect(await castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_B_ID, ACTOR_ID))
        .toEqual({ ok: true, action: "removed" });

      await resetPersona(db);
      const votes = await db.query<{ user_id: string; option_id: string }>(`
        SELECT user_id, option_id
        FROM public.community_poll_votes
        WHERE poll_id = '${SINGLE_POLL_ID}'
      `);
      expect(votes.rows).toEqual([{ user_id: OTHER_ID, option_id: SINGLE_OPTION_B_ID }]);
      expect((await readPollCounts(db, SINGLE_POLL_ID)).rows[0]).toEqual({
        total_voters: 1,
        total_votes: 1,
        actual_voters: 1,
        actual_votes: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves independent multi-choice toggles and distinct-voter counts", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      expect(await castVote(db, MULTI_POLL_ID, MULTI_OPTION_A_ID, ACTOR_ID))
        .toEqual({ ok: true, action: "added" });
      expect(await castVote(db, MULTI_POLL_ID, MULTI_OPTION_B_ID, ACTOR_ID))
        .toEqual({ ok: true, action: "added" });
      expect((await readPollCounts(db, MULTI_POLL_ID)).rows[0]).toEqual({
        total_voters: 1,
        total_votes: 2,
        actual_voters: 1,
        actual_votes: 2,
      });

      expect(await castVote(db, MULTI_POLL_ID, MULTI_OPTION_A_ID, ACTOR_ID))
        .toEqual({ ok: true, action: "removed" });
      expect((await readPollCounts(db, MULTI_POLL_ID)).rows[0]).toEqual({
        total_voters: 1,
        total_votes: 1,
        actual_voters: 1,
        actual_votes: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("returns the same not-found result for missing and inaccessible polls", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      expect(await castVote(db, MISSING_POLL_ID, MISSING_OPTION_ID, ACTOR_ID))
        .toEqual({ ok: false, error: "poll_not_found" });
      expect(await castVote(db, OTHER_DRAFT_POLL_ID, OTHER_DRAFT_OPTION_ID, ACTOR_ID))
        .toEqual({ ok: false, error: "poll_not_found" });
      expect(await castVote(db, OTHER_REVIEW_POLL_ID, OTHER_REVIEW_OPTION_ID, ACTOR_ID))
        .toEqual({ ok: false, error: "poll_not_found" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows members plus the actor's own draft and moderated poll", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      for (const [pollId, optionId] of [
        [MEMBERS_POLL_ID, MEMBERS_OPTION_ID],
        [OWN_DRAFT_POLL_ID, OWN_DRAFT_OPTION_ID],
        [OWN_REVIEW_POLL_ID, OWN_REVIEW_OPTION_ID],
      ]) {
        expect(await castVote(db, pollId, optionId, ACTOR_ID))
          .toEqual({ ok: true, action: "switched" });
      }
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("checks close time and option-to-poll membership after target access", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      expect(await castVote(db, CLOSED_POLL_ID, CLOSED_OPTION_ID, ACTOR_ID))
        .toEqual({ ok: false, error: "poll_closed" });
      expect(await castVote(db, SINGLE_POLL_ID, MISSING_OPTION_ID, ACTOR_ID))
        .toEqual({ ok: false, error: "option_invalid" });
      expect(await castVote(db, SINGLE_POLL_ID, MULTI_OPTION_A_ID, ACTOR_ID))
        .toEqual({ ok: false, error: "option_invalid" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("binds an authenticated caller to the actor UUID", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setClaims(db, "authenticated", ACTOR_ID);

      expect(await castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_A_ID, OTHER_ID))
        .toEqual({ ok: false, error: "forbidden" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("enforces single-choice and immutable-row invariants on privileged direct DML", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");
      await castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_A_ID, ACTOR_ID);
      await castVote(db, MULTI_POLL_ID, MULTI_OPTION_A_ID, OTHER_ID);
      await resetPersona(db);
      await setClaims(db, "service_role");

      await expect(db.query(`
        INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
        VALUES ('${SINGLE_POLL_ID}', '${SINGLE_OPTION_B_ID}', '${ACTOR_ID}')
      `)).rejects.toThrow(/poll_single_choice_conflict/i);

      await expect(db.query(`
        UPDATE public.community_poll_votes
        SET created_at = now()
        WHERE poll_id = '${SINGLE_POLL_ID}' AND user_id = '${ACTOR_ID}'
      `)).rejects.toThrow(/poll_vote_rows_are_immutable/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("uses the same trigger not-found signal for hidden and nonexistent targets", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setClaims(db, "service_role");

      for (const [pollId, optionId] of [
        [OTHER_DRAFT_POLL_ID, OTHER_DRAFT_OPTION_ID],
        [MISSING_POLL_ID, MISSING_OPTION_ID],
      ]) {
        await expect(db.query(`
          INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
          VALUES ('${pollId}', '${optionId}', '${ACTOR_ID}')
        `)).rejects.toThrow(/poll_vote_target_not_found/i);
      }
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("blocks a multi-to-single mode change while a user has multiple choices", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");
      await castVote(db, MULTI_POLL_ID, MULTI_OPTION_A_ID, ACTOR_ID);
      await castVote(db, MULTI_POLL_ID, MULTI_OPTION_B_ID, ACTOR_ID);
      await resetPersona(db);

      await expect(db.query(`
        UPDATE public.community_polls
        SET allow_multiple = false
        WHERE id = '${MULTI_POLL_ID}'
      `)).rejects.toThrow(/poll_has_multiple_choices/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("recounts exactly after account and option cascades, and skips a removed poll", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");
      await castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_A_ID, ACTOR_ID);
      await resetPersona(db);

      await db.exec(`DELETE FROM auth.users WHERE id = '${ACTOR_ID}'`);
      expect((await readPollCounts(db, SINGLE_POLL_ID)).rows[0]).toEqual({
        total_voters: 1,
        total_votes: 1,
        actual_voters: 1,
        actual_votes: 1,
      });

      await db.exec(`
        DELETE FROM public.community_poll_options
        WHERE id = '${SINGLE_OPTION_B_ID}'
      `);
      expect((await readPollCounts(db, SINGLE_POLL_ID)).rows[0]).toEqual({
        total_voters: 0,
        total_votes: 0,
        actual_voters: 0,
        actual_votes: 0,
      });

      await db.exec(`
        DELETE FROM public.community_posts WHERE id = '${MULTI_POST_ID}'
      `);
      expect((await db.query(`
        SELECT id FROM public.community_polls WHERE id = '${MULTI_POLL_ID}'
      `)).rows).toEqual([]);

      await db.exec(`
        DELETE FROM public.community_posts WHERE id = '${PUBLIC_POST_ID}'
      `);
      expect((await db.query(`
        SELECT id FROM public.community_polls WHERE id = '${SINGLE_POLL_ID}'
      `)).rows).toEqual([]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps service RPC execution but revokes all client and service table writes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      const privileges = await db.query<{
        auth_insert: boolean;
        auth_update: boolean;
        auth_delete: boolean;
        auth_truncate: boolean;
        auth_rpc: boolean;
        service_insert: boolean;
        service_update: boolean;
        service_delete: boolean;
        service_truncate: boolean;
        service_rpc: boolean;
      }>(`
        SELECT
          has_table_privilege('authenticated', 'public.community_poll_votes', 'INSERT')
            OR has_any_column_privilege('authenticated', 'public.community_poll_votes', 'INSERT')
            AS auth_insert,
          has_table_privilege('authenticated', 'public.community_poll_votes', 'UPDATE')
            OR has_any_column_privilege('authenticated', 'public.community_poll_votes', 'UPDATE')
            AS auth_update,
          has_table_privilege('authenticated', 'public.community_poll_votes', 'DELETE')
            AS auth_delete,
          has_table_privilege('authenticated', 'public.community_poll_votes', 'TRUNCATE')
            AS auth_truncate,
          has_function_privilege(
            'authenticated',
            'public.community_cast_poll_vote(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS auth_rpc,
          has_table_privilege('service_role', 'public.community_poll_votes', 'INSERT')
            OR has_any_column_privilege('service_role', 'public.community_poll_votes', 'INSERT')
            AS service_insert,
          has_table_privilege('service_role', 'public.community_poll_votes', 'UPDATE')
            OR has_any_column_privilege('service_role', 'public.community_poll_votes', 'UPDATE')
            AS service_update,
          has_table_privilege('service_role', 'public.community_poll_votes', 'DELETE')
            AS service_delete,
          has_table_privilege('service_role', 'public.community_poll_votes', 'TRUNCATE')
            AS service_truncate,
          has_function_privilege(
            'service_role',
            'public.community_cast_poll_vote(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS service_rpc
      `);
      expect(privileges.rows).toEqual([{
        auth_insert: false,
        auth_update: false,
        auth_delete: false,
        auth_truncate: false,
        auth_rpc: false,
        service_insert: false,
        service_update: false,
        service_delete: false,
        service_truncate: false,
        service_rpc: true,
      }]);

      await setPersona(db, "authenticated", ACTOR_ID);
      await expect(castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_A_ID, ACTOR_ID))
        .rejects.toThrow(/permission denied/i);
      await expect(db.query(`
        INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
        VALUES ('${SINGLE_POLL_ID}', '${SINGLE_OPTION_A_ID}', '${ACTOR_ID}')
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.query(`
        TRUNCATE TABLE public.community_poll_votes
      `)).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "service_role");
      expect(await castVote(db, SINGLE_POLL_ID, SINGLE_OPTION_A_ID, ACTOR_ID))
        .toEqual({ ok: true, action: "switched" });
      await expect(db.query(`
        DELETE FROM public.community_poll_votes
        WHERE poll_id = '${SINGLE_POLL_ID}' AND user_id = '${ACTOR_ID}'
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.query(`
        TRUNCATE TABLE public.community_poll_votes
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
