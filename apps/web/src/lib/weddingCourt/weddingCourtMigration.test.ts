// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731190000_wedding_court_safe_mvp.sql",
  ),
  "utf8",
);

const USER_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CASE_ONE = "11111111-1111-4111-8111-111111111901";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users (id) VALUES ('${USER_ONE}'), ('${USER_TWO}');
    GRANT USAGE ON SCHEMA public, auth
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid()
      TO anon, authenticated, service_role;
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId: string | null,
) {
  await db.query(
    "SELECT set_config('request.jwt.claim.sub', $1, false)",
    [userId ?? ""],
  );
  await db.exec(`SET ROLE ${role};`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

async function castFirstVote(
  db: PGlite,
  userId: string,
  choice: "a" | "b" = "a",
) {
  return db.query<{ result: { ok: boolean; action: string } }>(
    `
      SELECT public.wedding_court_cast_vote(
        $1::uuid,
        $2::uuid,
        1::smallint,
        $3::text,
        'couple_style'::text,
        'b'::text
      ) AS result
    `,
    [userId, CASE_ONE, choice],
  );
}

describe("wedding court safe MVP migration", () => {
  it("seeds only three synthetic, bounded, non-crisis cases", async () => {
    const db = await createDatabase();
    try {
      const cases = await db.query<{
        is_synthetic: boolean;
        content: string;
        chip_count: number;
      }>(`
        SELECT
          is_synthetic,
          concat_ws(
            ' ',
            title,
            question,
            opening,
            initial_facts::text,
            new_evidence,
            choice_a_perspective,
            choice_b_perspective,
            ending
          ) AS content,
          jsonb_array_length(reason_chips)::int AS chip_count
        FROM public.wedding_court_cases
        ORDER BY sort_order
      `);

      expect(cases.rows).toHaveLength(3);
      expect(cases.rows.every((row) => row.is_synthetic)).toBe(true);
      expect(cases.rows.every((row) => row.chip_count >= 4)).toBe(true);
      expect(cases.rows.map((row) => row.content).join(" ")).not.toMatch(
        /폭력|외도|임신|의료|법률|범죄|신체\s*비하/u,
      );
    } finally {
      await db.close();
    }
  });

  it("keeps case evidence server-only and grants authenticated users own-vote read only", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        case_select: boolean;
        vote_select: boolean;
        vote_insert: boolean;
        vote_update: boolean;
        vote_delete: boolean;
        rpc_execute: boolean;
        service_vote_insert: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'authenticated', 'public.wedding_court_cases', 'SELECT'
          ) AS case_select,
          has_table_privilege(
            'authenticated', 'public.wedding_court_votes', 'SELECT'
          ) AS vote_select,
          has_table_privilege(
            'authenticated', 'public.wedding_court_votes', 'INSERT'
          ) AS vote_insert,
          has_table_privilege(
            'authenticated', 'public.wedding_court_votes', 'UPDATE'
          ) AS vote_update,
          has_table_privilege(
            'authenticated', 'public.wedding_court_votes', 'DELETE'
          ) AS vote_delete,
          has_function_privilege(
            'authenticated',
            'public.wedding_court_cast_vote(uuid,uuid,smallint,text,text,text)',
            'EXECUTE'
          ) AS rpc_execute,
          has_table_privilege(
            'service_role', 'public.wedding_court_votes', 'INSERT'
          ) AS service_vote_insert
      `);

      expect(privileges.rows).toEqual([{
        case_select: false,
        vote_select: true,
        vote_insert: false,
        vote_update: false,
        vote_delete: false,
        rpc_execute: false,
        service_vote_insert: false,
      }]);

      const policies = await db.query<{ policyname: string; cmd: string }>(`
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'wedding_court_votes'
      `);
      expect(policies.rows).toEqual([{
        policyname: "wedding_court_votes_select_own",
        cmd: "SELECT",
      }]);
    } finally {
      await db.close();
    }
  });

  it("makes each round immutable and retries idempotent", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", null);

      const created = await castFirstVote(db, USER_ONE);
      expect(created.rows[0]?.result).toEqual({
        ok: true,
        action: "created",
      });

      const retried = await castFirstVote(db, USER_ONE);
      expect(retried.rows[0]?.result).toEqual({
        ok: true,
        action: "existing",
      });

      await expect(castFirstVote(db, USER_ONE, "b")).rejects.toThrow(
        /vote_locked/u,
      );

      await expect(
        db.query(
          `
            SELECT public.wedding_court_cast_vote(
              $1::uuid,
              $2::uuid,
              2::smallint,
              'b'::text,
              'family_sharing'::text,
              NULL::text
            )
          `,
          [USER_TWO, CASE_ONE],
        ),
      ).rejects.toThrow(/first_round_required/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("enforces own-vote RLS and rejects browser writes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", null);
      await castFirstVote(db, USER_ONE);
      await castFirstVote(db, USER_TWO, "b");
      await resetPersona(db);

      await setPersona(db, "authenticated", USER_ONE);
      const visible = await db.query<{ user_id: string; choice: string }>(`
        SELECT user_id, choice
        FROM public.wedding_court_votes
      `);
      expect(visible.rows).toEqual([{ user_id: USER_ONE, choice: "a" }]);

      await expect(
        db.exec(`
          INSERT INTO public.wedding_court_votes (
            case_id,
            user_id,
            round,
            choice,
            reason_chip,
            predicted_majority
          )
          VALUES (
            '${CASE_ONE}',
            '${USER_ONE}',
            2,
            'b',
            'family_sharing',
            NULL
          )
        `),
      ).rejects.toThrow(/permission denied/u);

      await expect(
        db.query("SELECT new_evidence FROM public.wedding_court_cases"),
      ).rejects.toThrow(/permission denied/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("deletes court votes with the Auth identity and has no planning-table side effect", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", null);
      await castFirstVote(db, USER_ONE);
      await resetPersona(db);

      await db.exec(`DELETE FROM auth.users WHERE id = '${USER_ONE}'`);

      const remaining = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.wedding_court_votes
        WHERE user_id = '${USER_ONE}'
      `);
      expect(remaining.rows).toEqual([{ count: 0 }]);
      expect(migration).not.toMatch(
        /(?:budget_items|schedule_events|decision_nodes|amora_actions)/u,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
