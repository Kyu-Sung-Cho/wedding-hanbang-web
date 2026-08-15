// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260814130000_amora_core_criterion.sql",
  ),
  "utf8",
);

const BRIDE_ID = "11111111-1111-4111-8111-111111111111";
const GROOM_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

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
      memory_key text,
      source_message_id uuid,
      source_actor_role text,
      superseded_at timestamptz,
      superseded_by uuid,
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

describe("Amora explicit core criterion migration", () => {
  it("appends one role-private user-confirmed criterion receipt", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.set_amora_core_criterion_v1(
          $1::uuid, $2::uuid, NULL::uuid, $3::uuid, $4::text, false
        ) AS value
      `, [COUPLE_ID, BRIDE_ID, REQUEST_ID, "우리 둘이 편안한 하루"]);

      expect(result.rows[0]?.value).toMatchObject({
        version: 1,
        deleted: false,
        value: "우리 둘이 편안한 하루",
      });
      const receipt = await db.query<Record<string, unknown>>(`
        SELECT category, decision_type, chosen_value, source, source_ref_id,
               visibility, source_actor_role, user_confirmed_at, metadata
        FROM public.decision_nodes
      `);
      expect(receipt.rows).toHaveLength(1);
      expect(receipt.rows[0]).toMatchObject({
        category: "preference",
        decision_type: "considering",
        chosen_value: { value: "우리 둘이 편안한 하루" },
        source: "manual",
        source_ref_id: REQUEST_ID,
        visibility: "bride_private",
        source_actor_role: "bride",
      });
      expect(receipt.rows[0]?.user_confirmed_at).toBeTruthy();
      expect(receipt.rows[0]?.metadata).toMatchObject({
        criterion_contract: "amora_core_criterion_v1",
        criterion_version: 1,
        owner_user_id: BRIDE_ID,
        explicit: true,
        criterion_deleted: false,
      });
    } finally {
      await db.close();
    }
  });

  it("rejects a stale device instead of overwriting the latest criterion", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await db.query(`
        SELECT public.set_amora_core_criterion_v1(
          $1::uuid, $2::uuid, NULL::uuid, $3::uuid, $4::text, false
        )
      `, [COUPLE_ID, BRIDE_ID, REQUEST_ID, "우리 둘이 편안한 하루"]);

      await expect(db.query(`
        SELECT public.set_amora_core_criterion_v1(
          $1::uuid, $2::uuid, NULL::uuid, $3::uuid, $4::text, false
        )
      `, [
        COUPLE_ID,
        BRIDE_ID,
        "55555555-5555-4555-8555-555555555555",
        "가족 모두가 편안한 하루",
      ])).rejects.toThrow("AMORA_CORE_CRITERION_CONFLICT");

      const count = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes",
      );
      expect(count.rows[0]?.count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("deletes by appending a private tombstone without rewriting the prior receipt", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const stored = await db.query<{ value: { criterionId: string } }>(`
        SELECT public.set_amora_core_criterion_v1(
          $1::uuid, $2::uuid, NULL::uuid, $3::uuid, $4::text, false
        ) AS value
      `, [COUPLE_ID, BRIDE_ID, REQUEST_ID, "우리 둘이 편안한 하루"]);
      const criterionId = stored.rows[0]!.value.criterionId;

      const deleted = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.set_amora_core_criterion_v1(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, NULL::text, true
        ) AS value
      `, [
        COUPLE_ID,
        BRIDE_ID,
        criterionId,
        "66666666-6666-4666-8666-666666666666",
      ]);

      expect(deleted.rows[0]?.value).toMatchObject({ version: 1, deleted: true });
      const receipts = await db.query<{
        id: string;
        chosen_value: unknown;
        metadata: Record<string, unknown>;
      }>(`
        SELECT id, chosen_value, metadata
        FROM public.decision_nodes
        ORDER BY created_at ASC, id ASC
      `);
      expect(receipts.rows).toHaveLength(2);
      expect(receipts.rows[0]?.id).toBe(criterionId);
      expect(receipts.rows[0]?.chosen_value).toEqual({ value: "우리 둘이 편안한 하루" });
      expect(receipts.rows[1]?.chosen_value).toEqual({ value: null });
      expect(receipts.rows[1]?.metadata).toMatchObject({ criterion_deleted: true });
    } finally {
      await db.close();
    }
  });
});
