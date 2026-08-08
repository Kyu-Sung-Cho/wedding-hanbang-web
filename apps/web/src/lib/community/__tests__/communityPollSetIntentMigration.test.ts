// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804160000_community_poll_set_intent.sql",
  ),
  "utf8",
);

const USER_ONE = "10000000-0000-4000-8000-000000000001";
const USER_TWO = "10000000-0000-4000-8000-000000000002";
const OUTSIDER = "10000000-0000-4000-8000-000000000003";

const PUBLIC_POST = "20000000-0000-4000-8000-000000000001";
const DRAFT_POST = "20000000-0000-4000-8000-000000000002";
const REVIEW_POST = "20000000-0000-4000-8000-000000000003";

const SINGLE_POLL = "30000000-0000-4000-8000-000000000001";
const MULTI_POLL = "30000000-0000-4000-8000-000000000002";
const CLOSED_POLL = "30000000-0000-4000-8000-000000000003";
const DRAFT_POLL = "30000000-0000-4000-8000-000000000004";
const REVIEW_POLL = "30000000-0000-4000-8000-000000000005";
const DRIFT_POLL = "30000000-0000-4000-8000-000000000006";
const MISSING_POLL = "30000000-0000-4000-8000-000000000099";

const SINGLE_A = "40000000-0000-4000-8000-000000000001";
const SINGLE_B = "40000000-0000-4000-8000-000000000002";
const MULTI_A = "40000000-0000-4000-8000-000000000003";
const MULTI_B = "40000000-0000-4000-8000-000000000004";
const CLOSED_A = "40000000-0000-4000-8000-000000000005";
const DRAFT_A = "40000000-0000-4000-8000-000000000006";
const REVIEW_A = "40000000-0000-4000-8000-000000000007";
const DRIFT_A = "40000000-0000-4000-8000-000000000008";
const DRIFT_B = "40000000-0000-4000-8000-000000000009";
const CROSS_POLL_VOTE = "50000000-0000-4000-8000-000000000003";

type Persona = "anon" | "authenticated" | "service_role";

type VoteResult = {
  ok: boolean;
  error?: string;
  action?: string;
  selected?: boolean;
  selected_option_ids?: string[];
  poll_version?: number;
  option_vote_count?: number;
  total_votes?: number;
  total_voters?: number;
  current_version?: number;
  poll?: Record<string, unknown>;
};

type CreateDatabaseOptions = {
  applyMigration?: boolean;
  crossPollVote?: boolean;
  singleChoiceLegacyDuplicate?: boolean;
};

async function createDatabase(options: CreateDatabaseOptions = {}) {
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
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      is_suspended boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_agent_personas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      backing_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL
    );

    CREATE TABLE public.community_runtime_control (
      mode text NOT NULL
    );
    INSERT INTO public.community_runtime_control (mode) VALUES ('normal');

    CREATE OR REPLACE FUNCTION public.community_request_is_service()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $$
      SELECT CASE
        WHEN COALESCE(current_setting('request.jwt.claim.role', true), '') <> ''
          THEN current_setting('request.jwt.claim.role', true) = 'service_role'
        ELSE current_user IN ('postgres', 'service_role')
      END
    $$;

    CREATE OR REPLACE FUNCTION public.community_runtime_mode()
    RETURNS text
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $$
      SELECT COALESCE((SELECT mode FROM public.community_runtime_control LIMIT 1), 'disabled')
    $$;

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL REFERENCES auth.users(id),
      visibility text NOT NULL CHECK (visibility IN ('public', 'members', 'draft')),
      under_review boolean DEFAULT false
    );

    CREATE TABLE public.community_polls (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL UNIQUE REFERENCES public.community_posts(id) ON DELETE CASCADE,
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
      poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
      position integer NOT NULL,
      label text NOT NULL,
      image_url text,
      vote_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (poll_id, position)
    );

    CREATE TABLE public.community_poll_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
      option_id uuid NOT NULL REFERENCES public.community_poll_options(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (option_id, user_id)
    );

    CREATE OR REPLACE FUNCTION public.community_poll_recount()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_poll_id uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.poll_id ELSE OLD.poll_id END;
      v_option_id uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.option_id ELSE OLD.option_id END;
    BEGIN
      UPDATE public.community_poll_options
      SET vote_count = (
        SELECT count(*)::integer FROM public.community_poll_votes WHERE option_id = v_option_id
      )
      WHERE id = v_option_id;
      UPDATE public.community_polls
      SET total_votes = (
            SELECT count(*)::integer FROM public.community_poll_votes WHERE poll_id = v_poll_id
          ),
          total_voters = (
            SELECT count(DISTINCT user_id)::integer FROM public.community_poll_votes WHERE poll_id = v_poll_id
          )
      WHERE id = v_poll_id;
      RETURN COALESCE(NEW, OLD);
    END
    $$;

    CREATE TRIGGER trg_poll_votes_recount
    AFTER INSERT OR DELETE ON public.community_poll_votes
    FOR EACH ROW EXECUTE FUNCTION public.community_poll_recount();

    CREATE OR REPLACE FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
    RETURNS jsonb
    LANGUAGE sql
    AS $$ SELECT '{"ok":true}'::jsonb $$;

    ALTER TABLE public.community_poll_votes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "poll_votes_select_own"
      ON public.community_poll_votes FOR SELECT
      USING (user_id = auth.uid());
    CREATE POLICY "poll_votes_insert_own"
      ON public.community_poll_votes FOR INSERT
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "poll_votes_delete_own"
      ON public.community_poll_votes FOR DELETE
      USING (user_id = auth.uid());

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.community_request_is_service() TO service_role;
    GRANT EXECUTE ON FUNCTION public.community_runtime_mode() TO service_role;
    GRANT SELECT ON TABLE public.community_posts, public.community_polls,
      public.community_poll_options, public.community_poll_votes
      TO authenticated, service_role;
    GRANT INSERT, UPDATE, DELETE ON TABLE public.community_poll_votes
      TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
      TO authenticated, service_role;

    INSERT INTO auth.users (id) VALUES
      ('${USER_ONE}'), ('${USER_TWO}'), ('${OUTSIDER}');

    INSERT INTO public.community_posts (id, author_id, visibility, under_review) VALUES
      ('${PUBLIC_POST}', '${USER_ONE}', 'public', false),
      ('${DRAFT_POST}', '${USER_ONE}', 'public', false),
      ('${REVIEW_POST}', '${USER_ONE}', 'public', true);

    INSERT INTO public.community_polls (
      id, post_id, question, allow_multiple, closes_at, total_voters, total_votes
    ) VALUES
      ('${SINGLE_POLL}', '${PUBLIC_POST}', 'single', false, NULL, 0, 0),
      ('${MULTI_POLL}', '${DRAFT_POST}', 'multi', true, NULL, 0, 0),
      ('${CLOSED_POLL}', '${REVIEW_POST}', 'closed', false, now() - interval '1 minute', 0, 0);

    -- Reuse the public/draft/review posts by giving the access-specific polls
    -- their own posts (the production schema is one poll per post).
    INSERT INTO public.community_posts (id, author_id, visibility, under_review) VALUES
      ('20000000-0000-4000-8000-000000000004', '${USER_ONE}', 'draft', false),
      ('20000000-0000-4000-8000-000000000005', '${USER_ONE}', 'public', true),
      ('20000000-0000-4000-8000-000000000006', '${USER_ONE}', 'public', false);
    INSERT INTO public.community_polls (
      id, post_id, question, allow_multiple, closes_at, total_voters, total_votes
    ) VALUES
      ('${DRAFT_POLL}', '20000000-0000-4000-8000-000000000004', 'draft', false, NULL, 0, 0),
      ('${REVIEW_POLL}', '20000000-0000-4000-8000-000000000005', 'review', false, NULL, 0, 0),
      ('${DRIFT_POLL}', '20000000-0000-4000-8000-000000000006', 'drift', ${options.singleChoiceLegacyDuplicate ? "false" : "true"}, NULL, -9, -9);

    INSERT INTO public.community_poll_options (
      id, poll_id, position, label, vote_count
    ) VALUES
      ('${SINGLE_A}', '${SINGLE_POLL}', 0, 'single a', 0),
      ('${SINGLE_B}', '${SINGLE_POLL}', 1, 'single b', 0),
      ('${MULTI_A}', '${MULTI_POLL}', 0, 'multi a', 0),
      ('${MULTI_B}', '${MULTI_POLL}', 1, 'multi b', 0),
      ('${CLOSED_A}', '${CLOSED_POLL}', 0, 'closed a', 0),
      ('${DRAFT_A}', '${DRAFT_POLL}', 0, 'draft a', 0),
      ('${REVIEW_A}', '${REVIEW_POLL}', 0, 'review a', 0),
      ('${DRIFT_A}', '${DRIFT_POLL}', 0, 'drift a', -4),
      ('${DRIFT_B}', '${DRIFT_POLL}', 1, 'drift b', -5);

    INSERT INTO public.community_poll_votes (
      id, poll_id, option_id, user_id, created_at
    ) VALUES
      ('50000000-0000-4000-8000-000000000001', '${DRIFT_POLL}', '${DRIFT_A}', '${USER_TWO}', now() - interval '2 minutes'),
      ('50000000-0000-4000-8000-000000000002', '${DRIFT_POLL}', '${DRIFT_B}', '${USER_TWO}', now() - interval '1 minute');

    -- Restore deliberately drifted values after the legacy recount trigger.
    UPDATE public.community_poll_options SET vote_count = -4 WHERE id = '${DRIFT_A}';
    UPDATE public.community_poll_options SET vote_count = -5 WHERE id = '${DRIFT_B}';
    UPDATE public.community_polls SET total_voters = -9, total_votes = -9 WHERE id = '${DRIFT_POLL}';

    INSERT INTO public.community_profiles(user_id) VALUES
      ('${USER_ONE}'), ('${USER_TWO}'), ('${OUTSIDER}');
  `);

  if (options.crossPollVote) {
    await db.exec(`
      INSERT INTO public.community_poll_votes(
        id, poll_id, option_id, user_id
      ) VALUES (
        '${CROSS_POLL_VOTE}', '${MULTI_POLL}', '${SINGLE_A}', '${OUTSIDER}'
      )
    `);
  }

  if (options.applyMigration !== false) {
    await db.exec(migration);
  }
  return db;
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

async function setPersona(
  db: PGlite,
  role: Persona,
  userId: string | null = null,
) {
  await resetPersona(db);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
  await db.exec(`SET ROLE ${role}`);
}

async function pollVersion(db: PGlite, pollId: string) {
  await setPersona(db, "service_role");
  const result = await db.query<{ version: number }>(
    "SELECT version::integer AS version FROM public.community_polls WHERE id = $1",
    [pollId],
  );
  return result.rows[0]!.version;
}

async function setVote(
  db: PGlite,
  input: {
    userId: string;
    pollId: string;
    optionId: string;
    selected: boolean;
    version: number;
    key: string;
  },
) {
  await setPersona(db, "service_role");
  const result = await db.query<{ result: VoteResult }>(
    `SELECT public.community_set_poll_vote(
      $1::uuid, $2::uuid, $3::uuid, $4::boolean, $5::bigint, $6::uuid
    ) AS result`,
    [
      input.userId,
      input.pollId,
      input.optionId,
      input.selected,
      input.version,
      input.key,
    ],
  );
  return result.rows[0]!.result;
}

async function replayVote(
  db: PGlite,
  input: {
    userId: string;
    pollId: string;
    optionId: string;
    selected: boolean;
    version: number;
    key: string;
  },
) {
  await setPersona(db, "service_role");
  const result = await db.query<{ result: VoteResult | null }>(
    `SELECT public.community_replay_poll_vote_command_service(
      $1::uuid, $2::uuid, $3::uuid, $4::boolean, $5::bigint, $6::uuid
    ) AS result`,
    [
      input.userId,
      input.pollId,
      input.optionId,
      input.selected,
      input.version,
      input.key,
    ],
  );
  return result.rows[0]!.result;
}

async function pollState(db: PGlite, pollId: string) {
  await setPersona(db, "service_role");
  const poll = await db.query<{
    total_votes: number;
    total_voters: number;
  }>(
    `SELECT total_votes, total_voters
     FROM public.community_polls
     WHERE id = $1`,
    [pollId],
  );
  const options = await db.query<{ id: string; vote_count: number }>(
    `SELECT id, vote_count
     FROM public.community_poll_options
     WHERE poll_id = $1
     ORDER BY position`,
    [pollId],
  );
  const votes = await db.query<{ user_id: string; option_id: string }>(
    `SELECT user_id, option_id
     FROM public.community_poll_votes
     WHERE poll_id = $1
     ORDER BY user_id, option_id`,
    [pollId],
  );
  return { poll: poll.rows[0]!, options: options.rows, votes: votes.rows };
}

describe("community poll set-intent migration", () => {
  it("quarantines every legacy cross-poll vote before adding the composite FK", async () => {
    const db = await createDatabase({ crossPollVote: true });
    try {
      await setPersona(db, "service_role");
      const inventory = await db.query<{
        source_vote_id: string;
        source_poll_id: string;
        option_id: string;
        option_poll_id: string;
        user_id: string;
        reason_code: string;
        source_count: number;
      }>(`
        SELECT
          quarantined.source_vote_id,
          quarantined.source_poll_id,
          quarantined.option_id,
          quarantined.option_poll_id,
          quarantined.user_id,
          quarantined.reason_code,
          (
            SELECT count(*)::int
            FROM public.community_poll_votes AS vote
            JOIN public.community_poll_options AS option
              ON option.id = vote.option_id
            WHERE vote.poll_id <> option.poll_id
          ) AS source_count
        FROM public.community_poll_vote_quarantine AS quarantined
        WHERE quarantined.source_vote_id = '${CROSS_POLL_VOTE}'
      `);
      expect(inventory.rows).toEqual([{
        source_vote_id: CROSS_POLL_VOTE,
        source_poll_id: MULTI_POLL,
        option_id: SINGLE_A,
        option_poll_id: SINGLE_POLL,
        user_id: OUTSIDER,
        reason_code: "poll_option_mismatch",
        source_count: 0,
      }]);

      await setPersona(db, "authenticated", USER_ONE);
      await expect(db.query(
        "SELECT * FROM public.community_poll_vote_quarantine",
      )).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await db.exec(`
        ALTER TABLE public.community_poll_votes
        DISABLE TRIGGER community_poll_vote_invariant
      `);
      await expect(db.exec(`
        INSERT INTO public.community_poll_votes(
          poll_id, option_id, user_id
        ) VALUES ('${MULTI_POLL}', '${SINGLE_A}', '${OUTSIDER}')
      `)).rejects.toThrow(/community_poll_votes_poll_option_fkey/iu);
      await db.exec(`
        ALTER TABLE public.community_poll_votes
        ENABLE TRIGGER community_poll_vote_invariant
      `);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed for legacy single-choice duplicates without choosing a winner", async () => {
    const db = await createDatabase({
      applyMigration: false,
      singleChoiceLegacyDuplicate: true,
    });
    try {
      await expect(db.exec(migration)).rejects.toThrow(
        /manual resolution required.*single-choice duplicate/iu,
      );
      await db.exec("ROLLBACK").catch(() => undefined);

      const preserved = await db.query<{ id: string }>(`
        SELECT id::text AS id
        FROM public.community_poll_votes
        WHERE poll_id = '${DRIFT_POLL}'
          AND user_id = '${USER_TWO}'
        ORDER BY created_at, id
      `);
      expect(preserved.rows).toEqual([
        { id: "50000000-0000-4000-8000-000000000001" },
        { id: "50000000-0000-4000-8000-000000000002" },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("revokes the legacy/direct write paths and exposes only the service RPC", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", USER_ONE);
      await expect(
        db.query(
          `SELECT public.community_set_poll_vote(
            '${USER_ONE}', '${SINGLE_POLL}', '${SINGLE_A}', true, 1,
            '60000000-0000-4000-8000-000000000001'
          )`,
        ),
      ).rejects.toThrow(/permission denied/iu);
      await expect(
        db.query(
          `SELECT public.community_cast_poll_vote(
            '${SINGLE_POLL}', '${SINGLE_A}', '${USER_ONE}'
          )`,
        ),
      ).rejects.toThrow(/permission denied/iu);
      await expect(
        db.exec(`
          INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
          VALUES ('${SINGLE_POLL}', '${SINGLE_A}', '${USER_ONE}')
        `),
      ).rejects.toThrow(/permission denied/iu);
      await expect(
        db.query("SELECT * FROM public.community_poll_vote_commands"),
      ).rejects.toThrow(/permission denied/iu);
      await expect(
        db.query(
          `SELECT public.community_replay_poll_vote_command_service(
            '${USER_ONE}', '${SINGLE_POLL}', '${SINGLE_A}', true, 1,
            '60000000-0000-4000-8000-000000000099'
          )`,
        ),
      ).rejects.toThrow(/permission denied/iu);

      await setPersona(db, "service_role");
      await expect(
        db.exec(`
          INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
          VALUES ('${SINGLE_POLL}', '${SINGLE_A}', '${USER_ONE}')
        `),
      ).rejects.toThrow(/permission denied/iu);
      await expect(
        db.query("SELECT * FROM public.community_poll_vote_commands"),
      ).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("replays an actor-and-payload-pinned receipt before terminal runtime and state gates", async () => {
    const db = await createDatabase();
    try {
      const version = await pollVersion(db, SINGLE_POLL);
      const key = "60500000-0000-4000-8000-000000000001";
      const input = {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version,
        key,
      };
      expect(await replayVote(db, input)).toBeNull();
      const initial = await setVote(db, input);
      expect(initial).not.toHaveProperty("replayed");

      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_runtime_control SET mode = 'disabled';
        UPDATE public.community_profiles
        SET is_suspended = true
        WHERE user_id = '${USER_ONE}';
        UPDATE public.community_posts
        SET under_review = true
        WHERE id = '${PUBLIC_POST}';
      `);

      expect(await replayVote(db, input)).toEqual(initial);
      expect(await setVote(db, input)).toEqual(initial);
      await expect(setVote(db, {
        ...input,
        key: "60500000-0000-4000-8000-000000000002",
      })).rejects.toThrow(/community is disabled/iu);
      await expect(replayVote(db, {
        ...input,
        selected: false,
      })).rejects.toThrow(/idempotency key reused with different payload/iu);
      await expect(replayVote(db, {
        ...input,
        userId: USER_TWO,
      })).resolves.toBeNull();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when a completed receipt is corrupt or missing", async () => {
    const db = await createDatabase();
    try {
      const version = await pollVersion(db, SINGLE_POLL);
      const corruptInput = {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version,
        key: "60600000-0000-4000-8000-000000000001",
      };
      await setVote(db, corruptInput);
      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_poll_vote_commands
        SET result = jsonb_set(result, '{total_votes}', '999'::jsonb)
        WHERE actor_id = '${USER_ONE}'
          AND idempotency_key = '${corruptInput.key}'
      `);
      await expect(replayVote(db, corruptInput)).rejects.toThrow(/digest mismatch/iu);
      await expect(setVote(db, corruptInput)).rejects.toThrow(/digest mismatch/iu);

      await resetPersona(db);
      await db.exec(`
        ALTER TABLE public.community_poll_vote_commands
        DROP CONSTRAINT community_poll_vote_commands_completion_valid;
        UPDATE public.community_poll_vote_commands
        SET result = NULL, result_digest = NULL
        WHERE actor_id = '${USER_ONE}'
          AND idempotency_key = '${corruptInput.key}'
      `);
      await expect(replayVote(db, corruptInput)).rejects.toThrow(/receipt is unavailable/iu);
      await expect(setVote(db, corruptInput)).rejects.toThrow(/command is unavailable/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("sets, switches, unsets, and exactly replays a single-choice intent", async () => {
    const db = await createDatabase();
    try {
      const version = await pollVersion(db, SINGLE_POLL);
      const firstKey = "61000000-0000-4000-8000-000000000001";
      const selected = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version,
        key: firstKey,
      });
      expect(selected).toMatchObject({
        ok: true,
        action: "selected",
        selected: true,
        selected_option_ids: [SINGLE_A],
        total_votes: 1,
        total_voters: 1,
      });
      expect(selected).not.toHaveProperty("replayed");

      const replay = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version,
        key: firstKey,
      });
      expect(replay).toEqual(selected);
      await expect(
        setVote(db, {
          userId: USER_ONE,
          pollId: SINGLE_POLL,
          optionId: SINGLE_A,
          selected: false,
          version,
          key: firstKey,
        }),
      ).rejects.toThrow(/idempotency key reused with different payload/iu);

      const switched = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_B,
        selected: true,
        version,
        key: "61000000-0000-4000-8000-000000000002",
      });
      expect(switched).toMatchObject({
        action: "switched",
        selected_option_ids: [SINGLE_B],
        total_votes: 1,
        total_voters: 1,
      });
      expect(await pollState(db, SINGLE_POLL)).toEqual({
        poll: { total_votes: 1, total_voters: 1 },
        options: [
          { id: SINGLE_A, vote_count: 0 },
          { id: SINGLE_B, vote_count: 1 },
        ],
        votes: [{ user_id: USER_ONE, option_id: SINGLE_B }],
      });

      const removed = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_B,
        selected: false,
        version,
        key: "61000000-0000-4000-8000-000000000003",
      });
      expect(removed).toMatchObject({
        action: "unselected",
        selected: false,
        selected_option_ids: [],
        total_votes: 0,
        total_voters: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("blocks suspended and agent selections while preserving replay and withdrawal", async () => {
    const db = await createDatabase();
    try {
      const version = await pollVersion(db, SINGLE_POLL);
      const selectedKey = "61500000-0000-4000-8000-000000000001";
      const selected = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version,
        key: selectedKey,
      });
      expect(selected).toMatchObject({ ok: true, selected: true });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_profiles
        SET is_suspended = true
        WHERE user_id = '${USER_ONE}'
      `);

      const receiptReplay = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version,
        key: selectedKey,
      });
      expect(receiptReplay).toEqual(selected);

      const withdrawn = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: false,
        version,
        key: "61500000-0000-4000-8000-000000000002",
      });
      expect(withdrawn).toMatchObject({
        ok: true,
        action: "unselected",
        selected: false,
      });

      await resetPersona(db);
      await db.exec(`
        INSERT INTO public.community_agent_personas(backing_user_id)
        VALUES ('${USER_TWO}')
      `);
      const agentDeniedKey = "61500000-0000-4000-8000-000000000003";
      const agentDenied = await setVote(db, {
        userId: USER_TWO,
        pollId: SINGLE_POLL,
        optionId: SINGLE_B,
        selected: true,
        version,
        key: agentDeniedKey,
      });
      expect(agentDenied).toMatchObject({
        ok: false,
        error: "actor_ineligible",
      });
      const deniedReplay = await setVote(db, {
        userId: USER_TWO,
        pollId: SINGLE_POLL,
        optionId: SINGLE_B,
        selected: true,
        version,
        key: agentDeniedKey,
      });
      expect(deniedReplay).toEqual(agentDenied);
      expect((await pollState(db, SINGLE_POLL)).votes).toEqual([]);

      await resetPersona(db);
      await expect(db.exec(`
        INSERT INTO public.community_poll_votes(poll_id, option_id, user_id)
        VALUES ('${SINGLE_POLL}', '${SINGLE_B}', '${USER_TWO}')
      `)).rejects.toThrow(/actor_ineligible/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("projects hidden results per explicit actor without base-counter bypass", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_polls
        SET hide_results_until_voted = true
        WHERE id = '${SINGLE_POLL}'
      `);
      const version = await pollVersion(db, SINGLE_POLL);
      await setVote(db, {
        userId: USER_TWO,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version,
        key: "61600000-0000-4000-8000-000000000001",
      });

      await setPersona(db, "service_role");
      const hidden = await db.query<{
        result: {
          ok: boolean;
          results_hidden: boolean;
          total_votes: number | null;
          total_voters: number | null;
          user_voted_option_ids: string[];
          options: Array<{ id: string; vote_count: number | null }>;
        };
      }>(`
        SELECT public.community_get_poll_actor_projection(
          '${USER_ONE}', '${SINGLE_POLL}'
        ) AS result
      `);
      expect(hidden.rows[0]?.result).toMatchObject({
        ok: true,
        results_hidden: true,
        total_votes: null,
        total_voters: null,
        user_voted_option_ids: [],
        options: [
          { id: SINGLE_A, vote_count: null },
          { id: SINGLE_B, vote_count: null },
        ],
      });

      const anonymous = await db.query<{ result: { results_hidden: boolean } }>(`
        SELECT public.community_get_poll_actor_projection(
          NULL, '${SINGLE_POLL}'
        ) AS result
      `);
      expect(anonymous.rows[0]?.result.results_hidden).toBe(true);

      const voted = await db.query<{
        result: {
          results_hidden: boolean;
          total_votes: number;
          total_voters: number;
          user_voted_option_ids: string[];
          options: Array<{ id: string; vote_count: number }>;
        };
      }>(`
        SELECT public.community_get_poll_actor_projection(
          '${USER_TWO}', '${SINGLE_POLL}'
        ) AS result
      `);
      expect(voted.rows[0]?.result).toMatchObject({
        results_hidden: false,
        total_votes: 1,
        total_voters: 1,
        user_voted_option_ids: [SINGLE_A],
        options: [
          { id: SINGLE_A, vote_count: 1 },
          { id: SINGLE_B, vote_count: 0 },
        ],
      });

      await setPersona(db, "authenticated", USER_ONE);
      await expect(db.query(`
        SELECT public.community_get_poll_actor_projection(
          '${USER_ONE}', '${SINGLE_POLL}'
        )
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.query(`
        SELECT total_votes FROM public.community_polls
        WHERE id = '${SINGLE_POLL}'
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.query(`
        SELECT vote_count FROM public.community_poll_options
        WHERE poll_id = '${SINGLE_POLL}'
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.query(`
        SELECT id, question, hide_results_until_voted
        FROM public.community_polls
        WHERE id = '${SINGLE_POLL}'
      `)).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps multi-choice vote and voter counters distinct and non-negative", async () => {
    const db = await createDatabase();
    try {
      const version = await pollVersion(db, MULTI_POLL);
      const intents = [
        [USER_ONE, MULTI_A, true, "62000000-0000-4000-8000-000000000001"],
        [USER_ONE, MULTI_B, true, "62000000-0000-4000-8000-000000000002"],
        [USER_TWO, MULTI_A, true, "62000000-0000-4000-8000-000000000003"],
        [USER_ONE, MULTI_A, false, "62000000-0000-4000-8000-000000000004"],
        [USER_ONE, MULTI_B, false, "62000000-0000-4000-8000-000000000005"],
      ] as const;

      const results: VoteResult[] = [];
      for (const [userId, optionId, selected, key] of intents) {
        results.push(
          await setVote(db, {
            userId,
            pollId: MULTI_POLL,
            optionId,
            selected,
            version,
            key,
          }),
        );
      }
      expect(results.map((result) => [result.total_votes, result.total_voters])).toEqual([
        [1, 1],
        [2, 1],
        [3, 2],
        [2, 2],
        [1, 1],
      ]);
      expect(await pollState(db, MULTI_POLL)).toEqual({
        poll: { total_votes: 1, total_voters: 1 },
        options: [
          { id: MULTI_A, vote_count: 1 },
          { id: MULTI_B, vote_count: 0 },
        ],
        votes: [{ user_id: USER_TWO, option_id: MULTI_A }],
      });
      expect(await pollVersion(db, MULTI_POLL)).toBe(version);

      await resetPersona(db);
      await expect(
        db.exec(`UPDATE public.community_polls SET total_votes = -1 WHERE id = '${MULTI_POLL}'`),
      ).rejects.toThrow(/community_polls_total_votes_nonnegative/iu);
      await expect(
        db.exec(`UPDATE public.community_poll_options SET vote_count = -1 WHERE id = '${MULTI_A}'`),
      ).rejects.toThrow(/community_poll_options_vote_count_nonnegative/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects stale, closed, inaccessible, and cross-poll intents before mutation", async () => {
    const db = await createDatabase();
    try {
      const singleVersion = await pollVersion(db, SINGLE_POLL);
      await resetPersona(db);
      await db.exec(
        `UPDATE public.community_polls SET question = 'changed' WHERE id = '${SINGLE_POLL}'`,
      );
      const stale = await setVote(db, {
        userId: USER_ONE,
        pollId: SINGLE_POLL,
        optionId: SINGLE_A,
        selected: true,
        version: singleVersion,
        key: "63000000-0000-4000-8000-000000000001",
      });
      expect(stale).toMatchObject({
        ok: false,
        error: "poll_stale",
        current_version: singleVersion + 1,
      });

      const optionDefinitionVersion = await pollVersion(db, DRAFT_POLL);
      await resetPersona(db);
      await db.exec(
        `UPDATE public.community_poll_options SET label = 'changed option' WHERE id = '${DRAFT_A}'`,
      );
      expect(await pollVersion(db, DRAFT_POLL)).toBe(optionDefinitionVersion + 1);

      const closed = await setVote(db, {
        userId: USER_ONE,
        pollId: CLOSED_POLL,
        optionId: CLOSED_A,
        selected: true,
        version: await pollVersion(db, CLOSED_POLL),
        key: "63000000-0000-4000-8000-000000000002",
      });
      expect(closed).toMatchObject({ ok: false, error: "poll_closed" });

      const draftDenied = await setVote(db, {
        userId: OUTSIDER,
        pollId: DRAFT_POLL,
        optionId: DRAFT_A,
        selected: true,
        version: await pollVersion(db, DRAFT_POLL),
        key: "63000000-0000-4000-8000-000000000003",
      });
      expect(draftDenied).toMatchObject({ ok: false, error: "forbidden" });

      const reviewDenied = await setVote(db, {
        userId: OUTSIDER,
        pollId: REVIEW_POLL,
        optionId: REVIEW_A,
        selected: true,
        version: await pollVersion(db, REVIEW_POLL),
        key: "63000000-0000-4000-8000-000000000004",
      });
      expect(reviewDenied).toMatchObject({ ok: false, error: "forbidden" });

      const reviewAuthor = await setVote(db, {
        userId: USER_ONE,
        pollId: REVIEW_POLL,
        optionId: REVIEW_A,
        selected: true,
        version: await pollVersion(db, REVIEW_POLL),
        key: "63000000-0000-4000-8000-000000000005",
      });
      expect(reviewAuthor).toMatchObject({ ok: true, selected: true });

      const invalidOption = await setVote(db, {
        userId: USER_ONE,
        pollId: DRAFT_POLL,
        optionId: REVIEW_A,
        selected: true,
        version: await pollVersion(db, DRAFT_POLL),
        key: "63000000-0000-4000-8000-000000000006",
      });
      expect(invalidOption).toMatchObject({ ok: false, error: "option_invalid" });

      const missingPoll = await setVote(db, {
        userId: USER_ONE,
        pollId: MISSING_POLL,
        optionId: SINGLE_A,
        selected: true,
        version: 1,
        key: "63000000-0000-4000-8000-000000000007",
      });
      expect(missingPoll).toMatchObject({ ok: false, error: "poll_not_found" });
      expect((await pollState(db, DRAFT_POLL)).votes).toHaveLength(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("repairs historical drift and serializes replay and competing single-choice intents", async () => {
    const db = await createDatabase();
    try {
      expect(await pollState(db, DRIFT_POLL)).toEqual({
        poll: { total_votes: 2, total_voters: 1 },
        options: [
          { id: DRIFT_A, vote_count: 1 },
          { id: DRIFT_B, vote_count: 1 },
        ],
        votes: [
          { user_id: USER_TWO, option_id: DRIFT_A },
          { user_id: USER_TWO, option_id: DRIFT_B },
        ],
      });

      const version = await pollVersion(db, SINGLE_POLL);
      const replayKey = "64000000-0000-4000-8000-000000000001";
      await setPersona(db, "service_role");
      const concurrentReplay = await Promise.all([
        db.query<{ result: VoteResult }>(
          `SELECT public.community_set_poll_vote(
            '${USER_ONE}', '${SINGLE_POLL}', '${SINGLE_A}', true, ${version}, '${replayKey}'
          ) AS result`,
        ),
        db.query<{ result: VoteResult }>(
          `SELECT public.community_set_poll_vote(
            '${USER_ONE}', '${SINGLE_POLL}', '${SINGLE_A}', true, ${version}, '${replayKey}'
          ) AS result`,
        ),
      ]);
      expect(concurrentReplay[1]!.rows[0]!.result).toEqual(
        concurrentReplay[0]!.rows[0]!.result,
      );
      expect(concurrentReplay[0]!.rows[0]!.result).not.toHaveProperty("replayed");
      expect((await pollState(db, SINGLE_POLL)).poll).toEqual({
        total_votes: 1,
        total_voters: 1,
      });

      await setPersona(db, "service_role");
      await Promise.all([
        db.query(
          `SELECT public.community_set_poll_vote(
            '${USER_ONE}', '${SINGLE_POLL}', '${SINGLE_A}', true, ${version},
            '64000000-0000-4000-8000-000000000002'
          )`,
        ),
        db.query(
          `SELECT public.community_set_poll_vote(
            '${USER_ONE}', '${SINGLE_POLL}', '${SINGLE_B}', true, ${version},
            '64000000-0000-4000-8000-000000000003'
          )`,
        ),
      ]);
      const finalState = await pollState(db, SINGLE_POLL);
      expect(finalState.votes).toHaveLength(1);
      expect(finalState.poll).toEqual({ total_votes: 1, total_voters: 1 });
      expect(finalState.options.reduce((sum, option) => sum + option.vote_count, 0)).toBe(1);

      await resetPersona(db);
      const otherOption = finalState.votes[0]!.option_id === SINGLE_A ? SINGLE_B : SINGLE_A;
      await expect(
        db.exec(`
          INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
          VALUES ('${SINGLE_POLL}', '${otherOption}', '${USER_ONE}')
        `),
      ).rejects.toThrow(/single_choice_violation/iu);

      await expect(
        db.exec(`DELETE FROM public.community_polls WHERE id = '${DRIFT_POLL}'`),
      ).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
