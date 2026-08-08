// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731191000_wedding_payment_ledger.sql",
  ),
  "utf8",
);

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_ID = "33333333-3333-4333-8333-333333333333";
const COUPLE_ID = "44444444-4444-4444-8444-444444444444";

async function createDatabase(): Promise<PGlite> {
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
      SELECT NULLIF(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $$;

    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      groom_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      couple_id uuid REFERENCES public.couples(id)
    );

    CREATE FUNCTION public.is_couple_member(p_couple_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.couples AS couple
        WHERE couple.id = p_couple_id
          AND (
            couple.bride_id = auth.uid()
            OR couple.groom_id = auth.uid()
          )
      )
    $$;

    GRANT USAGE ON SCHEMA public, auth
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), public.is_couple_member(uuid)
      TO authenticated, service_role;

    INSERT INTO auth.users (id) VALUES
      ('${MEMBER_ID}'),
      ('${PARTNER_ID}'),
      ('${OUTSIDER_ID}');
    INSERT INTO public.couples (id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${MEMBER_ID}', '${PARTNER_ID}');
    INSERT INTO public.profiles (id, couple_id) VALUES
      ('${MEMBER_ID}', '${COUPLE_ID}'),
      ('${PARTNER_ID}', '${COUPLE_ID}'),
      ('${OUTSIDER_ID}', NULL);
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
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

describe("wedding payment ledger migration", () => {
  it("keeps browser access read-only, couple-scoped, and deletion unavailable", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        authenticated_select: boolean;
        authenticated_insert: boolean;
        authenticated_update: boolean;
        authenticated_delete: boolean;
        anon_select: boolean;
        service_select: boolean;
        service_insert: boolean;
        service_update: boolean;
        service_delete: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'authenticated',
            'public.wedding_payment_ledger',
            'SELECT'
          ) AS authenticated_select,
          has_table_privilege(
            'authenticated',
            'public.wedding_payment_ledger',
            'INSERT'
          ) AS authenticated_insert,
          has_table_privilege(
            'authenticated',
            'public.wedding_payment_ledger',
            'UPDATE'
          ) AS authenticated_update,
          has_table_privilege(
            'authenticated',
            'public.wedding_payment_ledger',
            'DELETE'
          ) AS authenticated_delete,
          has_table_privilege(
            'anon',
            'public.wedding_payment_ledger',
            'SELECT'
          ) AS anon_select,
          has_table_privilege(
            'service_role',
            'public.wedding_payment_ledger',
            'SELECT'
          ) AS service_select,
          has_table_privilege(
            'service_role',
            'public.wedding_payment_ledger',
            'INSERT'
          ) AS service_insert,
          has_table_privilege(
            'service_role',
            'public.wedding_payment_ledger',
            'UPDATE'
          ) AS service_update,
          has_table_privilege(
            'service_role',
            'public.wedding_payment_ledger',
            'DELETE'
          ) AS service_delete
      `);
      expect(privileges.rows).toEqual([{
        authenticated_select: true,
        authenticated_insert: false,
        authenticated_update: false,
        authenticated_delete: false,
        anon_select: false,
        service_select: false,
        service_insert: false,
        service_update: false,
        service_delete: false,
      }]);

      await setPersona(db, "service_role", null);
      await db.query(`
        SELECT public.create_wedding_payment_ledger(
          '${MEMBER_ID}',
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000001',
          '예식장 계약',
          '한방 웨딩홀',
          'venue',
          20000000,
          2000000,
          '2026-10-01',
          1000000,
          'partially_paid',
          'provider_written'
        )
      `);

      await resetPersona(db);
      const generated = await db.query<{
        balance: number;
        revision: number;
      }>(`
        SELECT
          balance_amount_won::int AS balance,
          revision::int
        FROM public.wedding_payment_ledger
      `);
      expect(generated.rows).toEqual([{
        balance: 18_000_000,
        revision: 1,
      }]);

      await setPersona(db, "service_role", null);
      await expect(db.exec(`
        SELECT *
        FROM public.wedding_payment_ledger
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.exec(`
        INSERT INTO public.wedding_payment_ledger (
          couple_id,
          client_request_id,
          item_name,
          category_key
        )
        VALUES (
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000099',
          '직접 쓰기',
          'venue'
        )
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.exec(`
        UPDATE public.wedding_payment_ledger
        SET item_name = '직접 수정'
        WHERE couple_id = '${COUPLE_ID}'
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.exec(`
        DELETE FROM public.wedding_payment_ledger
        WHERE couple_id = '${COUPLE_ID}'
      `)).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await setPersona(db, "authenticated", MEMBER_ID);
      const memberRows = await db.query<{ item_name: string }>(`
        SELECT item_name
        FROM public.wedding_payment_ledger
      `);
      expect(memberRows.rows).toEqual([{ item_name: "예식장 계약" }]);
      await expect(db.exec(`
        UPDATE public.wedding_payment_ledger
        SET paid_amount_won = 3000000
      `)).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      const outsiderRows = await db.query<{ item_name: string }>(`
        SELECT item_name
        FROM public.wedding_payment_ledger
      `);
      expect(outsiderRows.rows).toEqual([]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("enforces amount, status, and text invariants at the database boundary", async () => {
    const db = await createDatabase();
    try {
      const insert = (overrides: string) => db.exec(`
        INSERT INTO public.wedding_payment_ledger (
          couple_id,
          client_request_id,
          item_name,
          category_key,
          contract_amount_won,
          paid_amount_won,
          refundable_amount_won,
          status,
          evidence_status
        )
        VALUES (
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000002',
          '예식장 계약',
          'venue',
          20000000,
          2000000,
          1000000,
          'partially_paid',
          'user_stated'
        )
        ${overrides}
      `);

      await expect(insert("")).resolves.toBeDefined();
      await expect(db.exec(`
        INSERT INTO public.wedding_payment_ledger (
          couple_id,
          client_request_id,
          item_name,
          category_key,
          contract_amount_won,
          paid_amount_won,
          status
        )
        VALUES (
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000003',
          E'줄바꿈\\n항목',
          'venue',
          1000,
          0,
          'contracted'
        )
      `)).rejects.toThrow(/wedding_payment_ledger_item_name_check/iu);
      await expect(db.exec(`
        INSERT INTO public.wedding_payment_ledger (
          couple_id,
          client_request_id,
          item_name,
          category_key,
          contract_amount_won,
          paid_amount_won,
          refundable_amount_won,
          status
        )
        VALUES (
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000004',
          '잘못된 금액',
          'venue',
          1000,
          1001,
          1002,
          'partially_paid'
        )
      `)).rejects.toThrow(/wedding_payment_ledger_(paid|refundable)_amount_check/iu);
      await expect(db.exec(`
        INSERT INTO public.wedding_payment_ledger (
          couple_id,
          client_request_id,
          item_name,
          category_key,
          contract_amount_won,
          paid_amount_won,
          status
        )
        VALUES (
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000005',
          '상태 불일치',
          'venue',
          1000,
          900,
          'paid'
        )
      `)).rejects.toThrow(/wedding_payment_ledger_status_amount_check/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically rechecks membership, deduplicates creates, and CAS-updates", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", null);
      const createSql = (itemName: string) => `
        SELECT public.create_wedding_payment_ledger(
          '${MEMBER_ID}',
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000010',
          '${itemName}',
          '한방 웨딩홀',
          'venue',
          20000000,
          2000000,
          '2026-10-01',
          1000000,
          'partially_paid',
          'provider_written'
        ) AS result
      `;
      const first = await db.query<{
        result: { id: string; revision: number };
      }>(createSql("예식장 계약"));
      const retry = await db.query<{
        result: { id: string; revision: number };
      }>(createSql("예식장 계약"));

      expect(retry.rows[0]?.result).toMatchObject({
        id: first.rows[0]?.result.id,
        revision: 1,
      });
      await resetPersona(db);
      const afterRetry = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.wedding_payment_ledger
        WHERE couple_id = '${COUPLE_ID}'
      `);
      expect(afterRetry.rows).toEqual([{ count: 1 }]);
      await setPersona(db, "service_role", null);
      await expect(
        db.query(createSql("같은 키의 다른 계약")),
      ).rejects.toThrow(/PAYMENT_LEDGER_IDEMPOTENCY_CONFLICT/iu);

      const updated = await db.query<{
        result: { id: string; revision: number; paid_amount_won: number };
      }>(`
        SELECT public.update_wedding_payment_ledger(
          '${MEMBER_ID}',
          '${COUPLE_ID}',
          '${first.rows[0]?.result.id}',
          1,
          '예식장 계약',
          '한방 웨딩홀',
          'venue',
          20000000,
          5000000,
          '2026-10-01',
          2000000,
          'partially_paid',
          'provider_written'
        ) AS result
      `);
      expect(updated.rows[0]?.result).toMatchObject({
        revision: 2,
        paid_amount_won: 5_000_000,
      });

      const lostResponseRetry = await db.query<{
        result: { revision: number };
      }>(`
        SELECT public.update_wedding_payment_ledger(
          '${MEMBER_ID}',
          '${COUPLE_ID}',
          '${first.rows[0]?.result.id}',
          1,
          '예식장 계약',
          '한방 웨딩홀',
          'venue',
          20000000,
          5000000,
          '2026-10-01',
          2000000,
          'partially_paid',
          'provider_written'
        ) AS result
      `);
      expect(lostResponseRetry.rows[0]?.result.revision).toBe(2);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.profiles
        SET couple_id = NULL
        WHERE id = '${MEMBER_ID}';
      `);
      await setPersona(db, "service_role", null);
      await expect(db.query(`
        SELECT public.create_wedding_payment_ledger(
          '${MEMBER_ID}',
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000011',
          '권한 해제 뒤 계약',
          NULL,
          'venue',
          1000,
          0,
          NULL,
          NULL,
          'contracted',
          'user_stated'
        )
      `)).rejects.toThrow(/PAYMENT_LEDGER_SCOPE_DENIED/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not block auth deletion and preserves a partnered ledger until the couple is removed", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", null);
      await db.query(`
        SELECT public.create_wedding_payment_ledger(
          '${MEMBER_ID}',
          '${COUPLE_ID}',
          '50000000-0000-4000-8000-000000000006',
          '예식장 계약',
          NULL,
          'venue',
          20000000,
          0,
          NULL,
          NULL,
          'contracted',
          'user_stated'
        )
      `);

      await resetPersona(db);
      await db.exec(`
        DELETE FROM auth.users
        WHERE id = '${MEMBER_ID}'
      `);
      const afterMemberDeletion = await db.query<{
        created_by: string | null;
        updated_by: string | null;
      }>(`
        SELECT created_by::text, updated_by::text
        FROM public.wedding_payment_ledger
        WHERE couple_id = '${COUPLE_ID}'
      `);
      expect(afterMemberDeletion.rows).toEqual([{
        created_by: null,
        updated_by: null,
      }]);

      await db.exec(`
        UPDATE public.profiles
        SET couple_id = NULL
        WHERE couple_id = '${COUPLE_ID}';
        DELETE FROM public.couples
        WHERE id = '${COUPLE_ID}';
      `);
      const afterCoupleDeletion = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.wedding_payment_ledger
      `);
      expect(afterCoupleDeletion.rows).toEqual([{ count: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
