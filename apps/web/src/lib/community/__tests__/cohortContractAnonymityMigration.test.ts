// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802156000_harden_cohort_contract_anonymity.sql",
  ),
  "utf8",
);

const ROOM_ID = "10000000-0000-4000-8000-000000000001";
const USERS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
  "20000000-0000-4000-8000-000000000005",
  "20000000-0000-4000-8000-000000000006",
] as const;

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
    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.cohort_contracts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      vendor_name text NOT NULL,
      category text NOT NULL,
      base_price integer,
      extra_price integer,
      notes text,
      created_at timestamptz DEFAULT now()
    );
    GRANT SELECT ON public.cohort_members TO service_role;
    ALTER TABLE public.cohort_contracts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cohort_contracts_select_own ON public.cohort_contracts
      FOR SELECT TO authenticated USING (user_id = auth.uid());
    CREATE POLICY cohort_contracts_insert ON public.cohort_contracts
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
    CREATE POLICY cohort_contracts_update ON public.cohort_contracts
      FOR UPDATE TO authenticated USING (user_id = auth.uid());
    CREATE POLICY cohort_contracts_delete ON public.cohort_contracts
      FOR DELETE TO authenticated USING (user_id = auth.uid());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_contracts
      TO authenticated, service_role;

    CREATE VIEW public.cohort_stats AS
    SELECT
      room_id,
      category,
      count(*) AS sample_size,
      round(avg(base_price))::integer AS avg_base_price,
      round(avg(extra_price))::integer AS avg_extra_price,
      round(avg(base_price + COALESCE(extra_price, 0)))::integer AS avg_total
    FROM public.cohort_contracts
    GROUP BY room_id, category;
    GRANT SELECT ON public.cohort_stats TO authenticated, service_role;

    INSERT INTO auth.users (id)
    SELECT value::uuid
    FROM unnest(ARRAY[
      '${USERS[0]}', '${USERS[1]}', '${USERS[2]}',
      '${USERS[3]}', '${USERS[4]}', '${USERS[5]}'
    ]) AS value;
    INSERT INTO public.cohort_members (room_id, user_id, is_active)
    SELECT '${ROOM_ID}', value::uuid, true
    FROM unnest(ARRAY[
      '${USERS[0]}', '${USERS[1]}', '${USERS[2]}',
      '${USERS[3]}', '${USERS[4]}'
    ]) AS value;
    INSERT INTO public.cohort_members (room_id, user_id, is_active)
    VALUES ('${ROOM_ID}', '${USERS[5]}', false);

    -- Historical duplicates are deliberately present before the hardening.
    INSERT INTO public.cohort_contracts (
      room_id, user_id, vendor_name, category, base_price, created_at
    ) VALUES
      ('${ROOM_ID}', '${USERS[0]}', 'old venue', 'venue', 100, '2026-01-01Z'),
      ('${ROOM_ID}', '${USERS[0]}', 'latest venue', 'venue', 200, '2026-02-01Z'),
      ('${ROOM_ID}', '${USERS[5]}', 'inactive makeup', 'makeup', 100, '2026-02-01Z');
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

async function upsertContract(
  db: PGlite,
  userId: string,
  category: string,
  basePrice: number,
  options: {
    expectedUserId?: string;
    vendorName?: string;
    extraPrice?: number | null;
    notes?: string | null;
  } = {},
) {
  return db.query<{ contract: Record<string, unknown> }>(
    `SELECT public.community_upsert_cohort_contract(
      $1, $2, $3, $4, $5, $6, $7, $8
    ) AS contract`,
    [
      options.expectedUserId ?? userId,
      userId,
      ROOM_ID,
      options.vendorName ?? `vendor-${userId.slice(-2)}`,
      category,
      basePrice,
      options.extraPrice ?? null,
      options.notes ?? null,
    ],
  );
}

describe("cohort contract anonymity migration", () => {
  it("deduplicates history and keeps repeated writes from one actor at one contribution", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      const historical = await db.query<{ vendor_name: string; base_price: number }>(`
        SELECT vendor_name, base_price
        FROM public.cohort_contracts
        WHERE room_id = '${ROOM_ID}'
          AND user_id = '${USERS[0]}'
          AND category = 'venue'
      `);
      expect(historical.rows).toEqual([{ vendor_name: "latest venue", base_price: 200 }]);

      await setPersona(db, "service_role");
      for (const amount of [100, 200, 300, 400, 500]) {
        await upsertContract(db, USERS[0], "venue", amount);
      }

      const rows = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.cohort_contracts
        WHERE room_id = '${ROOM_ID}' AND category = 'venue'
      `);
      const stats = await db.query<{
        sample_size: number;
        avg_base_price: number | null;
        avg_total: number | null;
      }>(`
        SELECT sample_size::integer, avg_base_price, avg_total
        FROM public.cohort_stats
        WHERE room_id = '${ROOM_ID}' AND category = 'venue'
      `);

      expect(rows.rows[0]?.count).toBe(1);
      expect(stats.rows[0]).toEqual({
        sample_size: 1,
        avg_base_price: null,
        avg_total: null,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps four contributors private and releases averages only at five distinct users", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      for (const [index, userId] of USERS.slice(0, 4).entries()) {
        await upsertContract(db, userId, "studio", (index + 1) * 100);
      }
      const four = await db.query<{
        sample_size: number;
        avg_base_price: number | null;
        avg_total: number | null;
      }>(`
        SELECT sample_size::integer, avg_base_price, avg_total
        FROM public.cohort_stats
        WHERE room_id = '${ROOM_ID}' AND category = 'studio'
      `);
      expect(four.rows[0]).toEqual({
        sample_size: 4,
        avg_base_price: null,
        avg_total: null,
      });

      await upsertContract(db, USERS[4], "studio", 500);
      const five = await db.query<{
        sample_size: number;
        avg_base_price: number | null;
        avg_total: number | null;
      }>(`
        SELECT sample_size::integer, avg_base_price, avg_total
        FROM public.cohort_stats
        WHERE room_id = '${ROOM_ID}' AND category = 'studio'
      `);
      expect(five.rows[0]).toEqual({
        sample_size: 5,
        avg_base_price: 300,
        avg_total: 300,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects actor mismatch, inactive membership, unsafe values, and direct REST-style DML", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await expect(
        upsertContract(db, USERS[1], "dress", 100, { expectedUserId: USERS[0] }),
      ).rejects.toThrow(/cohort_contract_actor_mismatch/i);
      await expect(
        upsertContract(db, USERS[5], "dress", 100),
      ).rejects.toThrow(/cohort_contract_membership_required/i);
      const inactiveStats = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.cohort_stats
        WHERE room_id = '${ROOM_ID}' AND category = 'makeup'
      `);
      expect(inactiveStats.rows[0]?.count).toBe(0);
      await expect(
        upsertContract(db, USERS[0], "invalid", 100),
      ).rejects.toThrow(/cohort_contract_category_invalid/i);
      await expect(
        upsertContract(db, USERS[0], "dress", -1),
      ).rejects.toThrow(/cohort_contract_price_invalid/i);
      await expect(
        upsertContract(db, USERS[0], "dress", 100_001),
      ).rejects.toThrow(/cohort_contract_price_invalid/i);
      await expect(
        upsertContract(db, USERS[0], "dress", 90_000, { extraPrice: 10_001 }),
      ).rejects.toThrow(/cohort_contract_price_invalid/i);
      await expect(
        upsertContract(db, USERS[0], "dress", 100, { vendorName: "x".repeat(201) }),
      ).rejects.toThrow(/cohort_contract_vendor_invalid/i);
      await expect(
        upsertContract(db, USERS[0], "dress", 100, { notes: "x".repeat(1001) }),
      ).rejects.toThrow(/cohort_contract_notes_invalid/i);
      await expect(db.exec(`
        INSERT INTO public.cohort_contracts (
          room_id, user_id, vendor_name, category, base_price
        ) VALUES ('${ROOM_ID}', '${USERS[0]}', 'service-direct', 'makeup', 100)
      `)).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "authenticated", USERS[0]);
      await expect(db.exec(`
        INSERT INTO public.cohort_contracts (
          room_id, user_id, vendor_name, category, base_price
        ) VALUES ('${ROOM_ID}', '${USERS[0]}', 'direct', 'makeup', 100)
      `)).rejects.toThrow(/permission denied|row-level security/i);
      await expect(db.exec(`
        UPDATE public.cohort_contracts
        SET base_price = 1
        WHERE room_id = '${ROOM_ID}' AND user_id = '${USERS[0]}'
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`
        DELETE FROM public.cohort_contracts
        WHERE room_id = '${ROOM_ID}' AND user_id = '${USERS[0]}'
      `)).rejects.toThrow(/permission denied/i);
      await expect(
        upsertContract(db, USERS[0], "makeup", 100),
      ).rejects.toThrow(/permission denied|service_role_required/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
