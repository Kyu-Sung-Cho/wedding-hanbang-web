// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718209000_price_combo_direct_write_fence.sql",
  ),
  "utf8",
);

const idempotencyMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718204000_price_combo_idempotency.sql",
  ),
  "utf8",
);

const releaseManifest = JSON.parse(readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/release-manifests/vendor-disclosure-v2-20260718.json",
  ),
  "utf8",
)) as {
  expandMigrations: Array<{ file: string; sha256: string }>;
};

const operationsDocument = readFileSync(
  resolve(
    process.cwd(),
    "../../docs/operations/PRICE_COMBO_DIRECT_WRITE_FENCE_2026-07-19.md",
  ),
  "utf8",
);

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const COMBO_A = "20000000-0000-4000-8000-000000000001";
const COMBO_B = "20000000-0000-4000-8000-000000000002";
const VENDOR_ID = "40000000-0000-4000-8000-000000000001";
const AGENCY_ID = "50000000-0000-4000-8000-000000000001";
const PRICE_ID = "60000000-0000-4000-8000-000000000001";
const OPTION_ID = "70000000-0000-4000-8000-000000000001";
const DIRECT_PRICE_ID = "60000000-0000-4000-8000-000000000002";
const DIRECT_OPTION_ID = "70000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = "80000000-0000-4000-8000-000000000001";
const REQUEST_HASH = "c".repeat(64);

function validSelections() {
  return {
    studio: {
      vendor_id: VENDOR_ID,
      agency_id: AGENCY_ID,
      base_krw: 1_240_000,
      selected_options: [{ name: "Original files", krw: 200_000 }],
      custom_krw: null,
    },
    dress: null,
    makeup: null,
  };
}

function directSelections(optionKrw: number) {
  return {
    studio: {
      vendor_id: VENDOR_ID,
      agency_id: null,
      base_krw: 1_000_000,
      selected_options: [{ name: "Original files", krw: optionKrw }],
      custom_krw: null,
    },
    dress: null,
    makeup: null,
  };
}

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

    CREATE TABLE public.combos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      name text NOT NULL DEFAULT 'My combo',
      selections jsonb NOT NULL DEFAULT '{}'::jsonb,
      total_krw integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT combos_name_check
        CHECK (length(btrim(name)) BETWEEN 1 AND 80),
      CONSTRAINT combos_selections_object_check
        CHECK (
          jsonb_typeof(selections) = 'object'
          AND (selections - ARRAY['studio', 'dress', 'makeup']::text[])
            = '{}'::jsonb
        ),
      CONSTRAINT combos_total_nonnegative_check
        CHECK (total_krw IS NULL OR total_krw >= 0)
    );
    ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.combos FORCE ROW LEVEL SECURITY;
    CREATE POLICY price_consumer_owner_all ON public.combos
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.combos
      TO authenticated, service_role;
    GRANT INSERT (user_id, name, selections, total_krw), UPDATE (name)
      ON public.combos TO authenticated, service_role;

    CREATE TABLE public.v_public_prices (
      official_price_id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL,
      category text NOT NULL,
      agency_id uuid,
      price_min_krw integer,
      is_current boolean NOT NULL
    );
    CREATE TABLE public.v_public_price_options (
      id uuid PRIMARY KEY,
      official_price_id uuid NOT NULL,
      name text NOT NULL,
      price_min_krw integer
    );

    INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
  `);
  await db.exec(idempotencyMigration);
  await db.exec(migration);
  await db.exec(`
    INSERT INTO public.v_public_prices (
      official_price_id, vendor_id, category, agency_id, price_min_krw,
      is_current
    ) VALUES
      (
        '${PRICE_ID}', '${VENDOR_ID}', 'studio', '${AGENCY_ID}', 1240000,
        true
      ),
      (
        '${DIRECT_PRICE_ID}', '${VENDOR_ID}', 'studio', NULL, 1000000,
        true
      );
    INSERT INTO public.v_public_price_options (
      id, official_price_id, name, price_min_krw
    ) VALUES
      (
        '${OPTION_ID}', '${PRICE_ID}', 'Original files', 200000
      ),
      (
        '${DIRECT_OPTION_ID}', '${DIRECT_PRICE_ID}', 'Original files', 20000
      );
    INSERT INTO public.combos (
      id, user_id, name, selections, total_krw, idempotency_key, request_hash
    ) VALUES
      (
        '${COMBO_A}', '${USER_A}', 'A combo',
        '{"studio": null, "dress": null, "makeup": null}'::jsonb,
        0, '30000000-0000-4000-8000-000000000001', repeat('a', 64)
      ),
      (
        '${COMBO_B}', '${USER_B}', 'B combo',
        '{"studio": null, "dress": null, "makeup": null}'::jsonb,
        0, '30000000-0000-4000-8000-000000000002', repeat('b', 64)
      );
  `);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
  userId = "",
) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
    userId,
  ]);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [
    role,
  ]);
  await db.exec(`SET ROLE ${role};`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function saveCombo(
  db: PGlite,
  overrides: Partial<{
    selections: unknown;
    totalKrw: number;
    idempotencyKey: string;
    requestHash: string;
  }> = {},
) {
  return db.query<{
    id: string;
    name: string;
    total_krw: number;
    request_hash: string;
    replayed: boolean;
  }>(`
    SELECT *
    FROM public.save_price_combo_service_v1(
      $1::uuid,
      $2::text,
      $3::jsonb,
      $4::integer,
      $5::uuid,
      $6::text
    )
  `, [
    USER_A,
    "Server combo",
    JSON.stringify(overrides.selections ?? validSelections()),
    overrides.totalKrw ?? 1_440_000,
    overrides.idempotencyKey ?? IDEMPOTENCY_KEY,
    overrides.requestHash ?? REQUEST_HASH,
  ]);
}

describe("price combo direct-write fence migration", () => {
  it("moves authenticated combo creation behind one service-only RPC", () => {
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE ON TABLE public.combos FROM authenticated, service_role;",
    );
    expect(migration).toContain(
      "CREATE POLICY price_combo_owner_select ON public.combos",
    );
    expect(migration).toContain(
      "CREATE POLICY price_combo_owner_delete ON public.combos",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.save_price_combo_service_v1(",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.save_price_combo_service_v1(",
    );
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*TO service_role;/u);
    expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE)[\s\S]*TO authenticated/iu);
  });

  it("pins the forward-only successor in order and documents the hosted gate", () => {
    const expectedHash = createHash("sha256")
      .update(migration.replace(/\r\n?/g, "\n"), "utf8")
      .digest("hex");
    expect(releaseManifest.expandMigrations.find(
      ({ file }) => file === "20260718209000_price_combo_direct_write_fence.sql",
    )).toEqual({
      file: "20260718209000_price_combo_direct_write_fence.sql",
      sha256: expectedHash,
    });
    expect(releaseManifest.expandMigrations.map(({ file }) => file)).toEqual(
      [...releaseManifest.expandMigrations.map(({ file }) => file)].sort(),
    );
    expect(operationsDocument).toContain("Rollback is forward-fix only");
    expect(operationsDocument).toContain("Production remains **NO-GO**");
    expect(operationsDocument).toContain("positive own `DELETE`");
  });

  it("denies direct authenticated writes while preserving owned reads and deletes", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        can_select: boolean;
        can_delete: boolean;
        can_insert: boolean;
        can_update: boolean;
      }>(`
        SELECT
          has_table_privilege('authenticated', 'public.combos', 'SELECT')
            AS can_select,
          has_table_privilege('authenticated', 'public.combos', 'DELETE')
            AS can_delete,
          has_table_privilege('authenticated', 'public.combos', 'INSERT')
            AS can_insert,
          has_table_privilege('authenticated', 'public.combos', 'UPDATE')
            AS can_update
      `);
      expect(privileges.rows).toEqual([{
        can_delete: true,
        can_insert: false,
        can_select: true,
        can_update: false,
      }]);

      await setPersona(db, "authenticated", USER_A);
      const visible = await db.query<{ id: string }>(`
        SELECT id FROM public.combos ORDER BY id
      `);
      expect(visible.rows).toEqual([{ id: COMBO_A }]);

      await expect(db.exec(`
        INSERT INTO public.combos (user_id, name, selections, total_krw)
        VALUES ('${USER_A}', 'Bypass', '{}'::jsonb, 0)
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.exec(`
        UPDATE public.combos SET name = 'Bypass' WHERE id = '${COMBO_A}'
      `)).rejects.toThrow(/permission denied/iu);

      const crossDelete = await db.query<{ id: string }>(`
        DELETE FROM public.combos WHERE id = '${COMBO_B}' RETURNING id
      `);
      expect(crossDelete.rows).toEqual([]);
      const ownDelete = await db.query<{ id: string }>(`
        DELETE FROM public.combos WHERE id = '${COMBO_A}' RETURNING id
      `);
      expect(ownDelete.rows).toEqual([{ id: COMBO_A }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows only the service RPC and keeps retries idempotent", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", USER_A);
      await expect(saveCombo(db)).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(db.exec(`
        INSERT INTO public.combos (user_id, name, selections, total_krw)
        VALUES ('${USER_A}', 'Service bypass', '{}'::jsonb, 0)
      `)).rejects.toThrow(/permission denied/iu);

      const first = await saveCombo(db);
      expect(first.rows).toEqual([expect.objectContaining({
        name: "Server combo",
        replayed: false,
        request_hash: REQUEST_HASH,
        total_krw: 1_440_000,
      })]);
      const replay = await saveCombo(db);
      expect(replay.rows).toEqual([expect.objectContaining({
        id: first.rows[0]?.id,
        replayed: true,
      })]);
      await expect(saveCombo(db, {
        requestHash: "d".repeat(64),
      })).rejects.toThrow(/PRICE_COMBO_IDEMPOTENCY_KEY_REUSED/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects shape, catalog, and total drift inside the service boundary", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");

      await expect(saveCombo(db, {
        selections: {
          ...validSelections(),
          hall: null,
        },
      })).rejects.toThrow(/PRICE_COMBO_SELECTIONS_SHAPE_INVALID/iu);

      await expect(saveCombo(db, {
        selections: {
          ...validSelections(),
          studio: {
            ...validSelections().studio,
            selected_options: [{ name: "Unpublished option", krw: 1 }],
          },
        },
        idempotencyKey: "80000000-0000-4000-8000-000000000002",
      })).rejects.toThrow(/PRICE_COMBO_PUBLIC_OPTION_NOT_FOUND/iu);

      await expect(saveCombo(db, {
        totalKrw: 1,
        idempotencyKey: "80000000-0000-4000-8000-000000000003",
      })).rejects.toThrow(/PRICE_COMBO_TOTAL_MISMATCH/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("does not mix a direct price with another agency's same-name option", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");

      const direct = await saveCombo(db, {
        selections: directSelections(20_000),
        totalKrw: 1_020_000,
        idempotencyKey: "80000000-0000-4000-8000-000000000004",
      });
      expect(direct.rows).toEqual([expect.objectContaining({
        total_krw: 1_020_000,
      })]);

      await expect(saveCombo(db, {
        selections: directSelections(200_000),
        totalKrw: 1_200_000,
        idempotencyKey: "80000000-0000-4000-8000-000000000005",
      })).rejects.toThrow(/PRICE_COMBO_PUBLIC_OPTION_NOT_FOUND/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("is replay-safe without recreating a permissive mutation policy", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      const policies = await db.query<{ policyname: string; cmd: string }>(`
        SELECT policyname, cmd
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'combos'
        ORDER BY policyname
      `);
      expect(policies.rows).toEqual([
        { cmd: "DELETE", policyname: "price_combo_owner_delete" },
        { cmd: "SELECT", policyname: "price_combo_owner_select" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
