// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260814140000_amora_couple_core_criterion.sql",
  ),
  "utf8",
);

const BRIDE_ID = "11111111-1111-4111-8111-111111111111";
const GROOM_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const CURRENT_DECISION_ID = "44444444-4444-4444-8444-444444444444";
const PROPOSE_REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const ACCEPT_REQUEST_ID = "66666666-6666-4666-8666-666666666666";

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      category text,
      decision_type text,
      title text,
      chosen_value jsonb,
      options_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric,
      stage_tag text,
      decided_at timestamptz,
      source text,
      source_ref_id uuid,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      source_actor_role text,
      user_confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom');
    INSERT INTO public.decision_nodes(
      id, couple_id, category, decision_type, title, chosen_value,
      options_considered, reasoning, confidence, decided_at, source,
      source_ref_id, metadata, visibility, source_actor_role,
      user_confirmed_at
    ) VALUES (
      '${CURRENT_DECISION_ID}', '${COUPLE_ID}', 'preference', 'decided',
      '우리 기준', '{"value":"우리 둘이 편안한 하루"}'::jsonb,
      '[]'::jsonb, '두 사람이 직접 확인한 기준', 1.00, clock_timestamp(),
      'manual', gen_random_uuid(),
      jsonb_build_object(
        'criterion_contract', 'amora_couple_core_criterion_v1',
        'criterion_version', 1,
        'bride_user_id', '${BRIDE_ID}',
        'groom_user_id', '${GROOM_ID}',
        'acceptance_count', 2,
        'explicit', true
      ),
      'shared', NULL, clock_timestamp()
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
    GRANT SELECT, INSERT ON public.decision_nodes TO service_role;
    GRANT SELECT ON public.couples, public.profiles TO service_role;
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(db: PGlite, role: "authenticated" | "service_role") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.exec(`SET ROLE ${role}`);
}

describe("Amora couple core criterion migration", () => {
  it("keeps the current criterion while one reviewed replacement waits, then confirms once after the exact partner accepts", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const proposed = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.propose_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text
        ) AS value
      `, [
        COUPLE_ID,
        BRIDE_ID,
        CURRENT_DECISION_ID,
        PROPOSE_REQUEST_ID,
        "가족 요청보다 우리 둘의 기준을 먼저 확인하기",
      ]);

      expect(proposed.rows[0]?.value).toMatchObject({
        version: 1,
        coupleId: COUPLE_ID,
        linked: true,
        current: {
          decisionId: CURRENT_DECISION_ID,
          value: "우리 둘이 편안한 하루",
        },
        proposal: {
          proposerUserId: BRIDE_ID,
          acceptedUserIds: [BRIDE_ID],
          revision: 1,
        },
      });
      const proposal = proposed.rows[0]!.value.proposal as { id: string };
      const before = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.decision_nodes
        WHERE metadata ->> 'criterion_contract' = 'amora_couple_core_criterion_v1'
      `);
      expect(before.rows[0]?.count).toBe(1);

      const confirmed = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.accept_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, 1::bigint, $4::uuid
        ) AS value
      `, [COUPLE_ID, GROOM_ID, proposal.id, ACCEPT_REQUEST_ID]);

      expect(confirmed.rows[0]?.value).toMatchObject({
        version: 1,
        coupleId: COUPLE_ID,
        linked: true,
        current: { value: "가족 요청보다 우리 둘의 기준을 먼저 확인하기" },
        proposal: null,
      });
      const receipts = await db.query<{
        chosen_value: { value: string };
        metadata: Record<string, unknown>;
        source_actor_role: string | null;
      }>(`
        SELECT chosen_value, metadata, source_actor_role
        FROM public.decision_nodes
        WHERE metadata ->> 'criterion_contract' = 'amora_couple_core_criterion_v1'
        ORDER BY created_at ASC, id ASC
      `);
      expect(receipts.rows).toHaveLength(2);
      expect(receipts.rows[1]).toMatchObject({
        chosen_value: { value: "가족 요청보다 우리 둘의 기준을 먼저 확인하기" },
        source_actor_role: null,
        metadata: {
          bride_user_id: BRIDE_ID,
          groom_user_id: GROOM_ID,
          acceptance_count: 2,
          explicit: true,
        },
      });
      expect(await db.query(`
        SELECT public.accept_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, 1::bigint, $4::uuid
        )
      `, [COUPLE_ID, GROOM_ID, proposal.id, ACCEPT_REQUEST_ID])).toBeTruthy();
      const finalCount = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.decision_nodes
        WHERE metadata ->> 'criterion_contract' = 'amora_couple_core_criterion_v1'
      `);
      expect(finalCount.rows[0]?.count).toBe(2);
    } finally {
      await db.close();
    }
  });

  it("lets only the proposer cancel and never lets one person supply both confirmations", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const proposed = await db.query<{ value: { proposal: { id: string } } }>(`
        SELECT public.propose_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text
        ) AS value
      `, [
        COUPLE_ID,
        BRIDE_ID,
        CURRENT_DECISION_ID,
        PROPOSE_REQUEST_ID,
        "우리 둘이 감당할 수 있는 범위 먼저 보기",
      ]);
      const proposalId = proposed.rows[0]!.value.proposal.id;

      await expect(db.query(`
        SELECT public.accept_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, 1::bigint, $4::uuid
        )
      `, [
        COUPLE_ID,
        BRIDE_ID,
        proposalId,
        "77777777-7777-4777-8777-777777777777",
      ])).rejects.toThrow("AMORA_COUPLE_CRITERION_ALREADY_ACCEPTED");
      await expect(db.query(`
        SELECT public.cancel_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, 1::bigint, $4::uuid
        )
      `, [
        COUPLE_ID,
        GROOM_ID,
        proposalId,
        "88888888-8888-4888-8888-888888888888",
      ])).rejects.toThrow("AMORA_COUPLE_CRITERION_CONFLICT");

      const cancelled = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.cancel_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, 1::bigint, $4::uuid
        ) AS value
      `, [
        COUPLE_ID,
        BRIDE_ID,
        proposalId,
        "99999999-9999-4999-8999-999999999999",
      ]);
      expect(cancelled.rows[0]?.value).toMatchObject({
        current: { decisionId: CURRENT_DECISION_ID },
        proposal: null,
      });
      const count = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.decision_nodes
      `);
      expect(count.rows[0]?.count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("keeps proposal storage and every mutation RPC service-only", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated");
      await expect(db.query(`
        SELECT public.read_amora_couple_core_criterion_v1($1::uuid, $2::uuid)
      `, [COUPLE_ID, BRIDE_ID])).rejects.toThrow();
      await expect(db.query(`
        SELECT * FROM public.amora_couple_core_criterion_proposals
      `)).rejects.toThrow();
      await expect(db.query(`
        SELECT public.propose_amora_couple_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text
        )
      `, [
        COUPLE_ID,
        BRIDE_ID,
        CURRENT_DECISION_ID,
        PROPOSE_REQUEST_ID,
        "직접 접근은 차단",
      ])).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
