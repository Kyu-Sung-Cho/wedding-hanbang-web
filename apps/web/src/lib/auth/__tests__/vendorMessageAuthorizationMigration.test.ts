// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const relationshipMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802144000_vendor_message_relationship_authorization.sql",
  ),
  "utf8",
);
const readFenceMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802147000_vendor_message_trusted_thread_read_fence.sql",
  ),
  "utf8",
);
const migration = `${relationshipMigration}\n${readFenceMigration}`;

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const BOOKED_CUSTOMER_ID = "00000000-0000-4000-8000-000000000003";
const CANCELLED_CUSTOMER_ID = "00000000-0000-4000-8000-000000000004";
const VENDOR_OWNER_ID = "10000000-0000-4000-8000-000000000001";
const APPROVED_VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const PENDING_VENDOR_ID = "20000000-0000-4000-8000-000000000002";
const REJECTED_VENDOR_ID = "20000000-0000-4000-8000-000000000003";
const OWNERLESS_VENDOR_ID = "20000000-0000-4000-8000-000000000004";
const BOOKED_COUPLE_ID = "30000000-0000-4000-8000-000000000001";
const CANCELLED_COUPLE_ID = "30000000-0000-4000-8000-000000000002";
const BOOKING_ID = "40000000-0000-4000-8000-000000000001";
const CANCELLED_BOOKING_ID = "40000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role(), auth.uid() TO PUBLIC;

    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      owner_id uuid,
      status text NOT NULL
    );
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      status text NOT NULL
    );
    CREATE TABLE public.vendor_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL,
      sender_type text NOT NULL CHECK (sender_type IN ('customer', 'vendor')),
      content text NOT NULL,
      is_read boolean NOT NULL DEFAULT false,
      booking_id uuid REFERENCES public.vendor_bookings(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.vendor_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY vendor_messages_select ON public.vendor_messages
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY legacy_vendor_messages_select ON public.vendor_messages
      FOR SELECT TO authenticated USING (true);

    CREATE FUNCTION public.is_current_couple_member(
      p_user_id uuid,
      p_couple_id uuid
    )
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT p_user_id IS NOT NULL
        AND p_couple_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.profiles AS profile
          JOIN public.couples AS couple ON couple.id = profile.couple_id
          WHERE profile.id = p_user_id
            AND profile.couple_id = p_couple_id
            AND (
              (profile.role = 'bride' AND couple.bride_id = p_user_id)
              OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
            )
        )
    $$;

    GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid, uuid)
      TO service_role;
    GRANT SELECT ON TABLE public.vendor_messages TO anon, authenticated, service_role;
    GRANT INSERT, UPDATE ON TABLE public.vendor_messages TO service_role;

    INSERT INTO public.vendors(id, owner_id, status) VALUES
      ('${APPROVED_VENDOR_ID}', '${VENDOR_OWNER_ID}', 'approved'),
      ('${PENDING_VENDOR_ID}', '${VENDOR_OWNER_ID}', 'pending'),
      ('${REJECTED_VENDOR_ID}', '${VENDOR_OWNER_ID}', 'rejected'),
      ('${OWNERLESS_VENDOR_ID}', NULL, 'approved');

    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${BOOKED_COUPLE_ID}', '${BOOKED_CUSTOMER_ID}', NULL),
      ('${CANCELLED_COUPLE_ID}', '${CANCELLED_CUSTOMER_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BOOKED_CUSTOMER_ID}', '${BOOKED_COUPLE_ID}', 'bride'),
      ('${CANCELLED_CUSTOMER_ID}', '${CANCELLED_COUPLE_ID}', 'bride');
    INSERT INTO public.vendor_bookings(id, vendor_id, couple_id, status) VALUES
      ('${BOOKING_ID}', '${APPROVED_VENDOR_ID}', '${BOOKED_COUPLE_ID}', 'confirmed'),
      ('${CANCELLED_BOOKING_ID}', '${APPROVED_VENDOR_ID}', '${CANCELLED_COUPLE_ID}', 'cancelled');

    -- Historical row produced through the vulnerable direct-RLS path. The
    -- vendor forged sender_type='customer', so that label alone must never
    -- bootstrap authorization after this migration.
    INSERT INTO public.vendor_messages(
      vendor_id, customer_id, sender_type, content
    ) VALUES (
      '${APPROVED_VENDOR_ID}', '${OTHER_CUSTOMER_ID}', 'customer', 'legacy forged customer'
    );
  `);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId?: string,
) {
  await db.exec(`
    SET ROLE ${role};
    SELECT set_config('request.jwt.claim.role', '${role}', false);
    SELECT set_config('request.jwt.claim.sub', '${userId ?? ""}', false);
  `);
}

async function resetPersona(db: PGlite) {
  await db.exec(`
    RESET ROLE;
    SELECT set_config('request.jwt.claim.role', '', false);
    SELECT set_config('request.jwt.claim.sub', '', false);
  `);
}

async function sendMessage(
  db: PGlite,
  actorId: string,
  vendorId: string,
  customerId: string | null,
  content: string,
) {
  return db.query<{
    vendor_id: string;
    customer_id: string;
    sender_type: string;
    content: string;
    booking_id: string | null;
    server_provenance_version: number | null;
  }>(`
    SELECT vendor_id, customer_id, sender_type, content, booking_id,
           server_provenance_version
    FROM public.send_vendor_message_service_v1($1, $2, $3, $4)
  `, [actorId, vendorId, customerId, content]);
}

async function markMessagesRead(
  db: PGlite,
  actorId: string,
  vendorId: string,
  customerId: string | null,
) {
  return db.query<{ marked_count: number }>(`
    SELECT public.mark_vendor_messages_read_service_v1($1, $2, $3)
      AS marked_count
  `, [actorId, vendorId, customerId]);
}

describe("vendor message relationship authorization migration", () => {
  it("allows customers to start only with an approved, owned vendor", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      const inserted = await sendMessage(
        db,
        CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        null,
        "approved vendor inquiry",
      );
      expect(inserted.rows).toEqual([{
        vendor_id: APPROVED_VENDOR_ID,
        customer_id: CUSTOMER_ID,
        sender_type: "customer",
        content: "approved vendor inquiry",
        booking_id: null,
        server_provenance_version: 1,
      }]);

      for (const unavailableVendorId of [
        PENDING_VENDOR_ID,
        REJECTED_VENDOR_ID,
        OWNERLESS_VENDOR_ID,
      ]) {
        await expect(sendMessage(
          db,
          CUSTOMER_ID,
          unavailableVendorId,
          null,
          "must fail",
        )).rejects.toThrow(/vendor_message_vendor_unavailable/i);
      }
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects customer UUID overrides and vendor-first targeting without a real relationship", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await expect(sendMessage(
        db,
        CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        OTHER_CUSTOMER_ID,
        "spoof another customer",
      )).rejects.toThrow(/vendor_message_customer_override_forbidden/i);

      await expect(sendMessage(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        "00000000-0000-4000-8000-000000000099",
        "target arbitrary UUID",
      )).rejects.toThrow(/vendor_message_relationship_required/i);

      // A historical customer-labelled row has no server provenance. The old
      // RLS allowed vendors to forge it, so it cannot establish consent.
      await expect(sendMessage(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        OTHER_CUSTOMER_ID,
        "follow up on forged row",
      )).rejects.toThrow(/vendor_message_relationship_required/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("allows vendor replies only after a trusted exact thread, never from booking context alone", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await sendMessage(db, CUSTOMER_ID, APPROVED_VENDOR_ID, null, "customer starts");
      const reply = await sendMessage(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        CUSTOMER_ID,
        "vendor reply",
      );
      expect(reply.rows[0]).toMatchObject({
        vendor_id: APPROVED_VENDOR_ID,
        customer_id: CUSTOMER_ID,
        sender_type: "vendor",
        booking_id: null,
        server_provenance_version: 1,
      });

      await expect(sendMessage(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        BOOKED_CUSTOMER_ID,
        "booking follow-up",
      )).rejects.toThrow(/vendor_message_relationship_required/i);

      await expect(sendMessage(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        CANCELLED_CUSTOMER_ID,
        "cancelled booking follow-up",
      )).rejects.toThrow(/vendor_message_relationship_required/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("exposes only trusted rows to the customer or the currently approved vendor owner", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");
      await sendMessage(
        db,
        CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        null,
        "trusted customer message",
      );

      await resetPersona(db);
      await setPersona(db, "authenticated", OTHER_CUSTOMER_ID);
      const legacyCustomerRead = await db.query<{ content: string }>(`
        SELECT content FROM public.vendor_messages ORDER BY created_at
      `);
      expect(legacyCustomerRead.rows).toEqual([]);

      await resetPersona(db);
      await setPersona(db, "authenticated", CUSTOMER_ID);
      const trustedCustomerRead = await db.query<{ content: string }>(`
        SELECT content FROM public.vendor_messages ORDER BY created_at
      `);
      expect(trustedCustomerRead.rows).toEqual([{ content: "trusted customer message" }]);

      await resetPersona(db);
      await setPersona(db, "authenticated", VENDOR_OWNER_ID);
      const approvedOwnerRead = await db.query<{ content: string }>(`
        SELECT content FROM public.vendor_messages ORDER BY created_at
      `);
      expect(approvedOwnerRead.rows).toEqual([{ content: "trusted customer message" }]);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.vendors
        SET status = 'rejected'
        WHERE id = '${APPROVED_VENDOR_ID}'
      `);
      await setPersona(db, "authenticated", VENDOR_OWNER_ID);
      const rejectedOwnerRead = await db.query<{ content: string }>(`
        SELECT content FROM public.vendor_messages ORDER BY created_at
      `);
      expect(rejectedOwnerRead.rows).toEqual([]);

      await resetPersona(db);
      await setPersona(db, "service_role");
      const quarantinedLegacyRows = await db.query<{
        content: string;
        server_provenance_version: number | null;
      }>(`
        SELECT content, server_provenance_version
        FROM public.vendor_messages
        WHERE server_provenance_version IS NULL
      `);
      expect(quarantinedLegacyRows.rows).toEqual([{
        content: "legacy forged customer",
        server_provenance_version: null,
      }]);

      await resetPersona(db);
      const policies = await db.query<{
        policy_count: number;
        policy_name: string;
        authenticated_only: boolean;
        using_expression: string;
      }>(`
        SELECT
          count(*)::integer AS policy_count,
          min(policy.polname) AS policy_name,
          bool_and(
            cardinality(policy.polroles) = 1
            AND policy.polroles[1] = (
              SELECT role.oid
              FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'authenticated'
            )
          ) AS authenticated_only,
          min(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid))
            AS using_expression
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = 'public.vendor_messages'::regclass
          AND policy.polcmd = 'r'
      `);
      expect(policies.rows[0]).toMatchObject({
        policy_count: 1,
        policy_name: "vendor_messages_select",
        authenticated_only: true,
      });
      expect(policies.rows[0].using_expression).toContain(
        "server_provenance_version = 1",
      );
      expect(policies.rows[0].using_expression).toContain(
        "customer_id = auth.uid()",
      );
      expect(policies.rows[0].using_expression).toContain(
        "is_approved_vendor_owner(vendor_id)",
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("marks trusted counterpart messages atomically and denies a revoked vendor", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");
      await sendMessage(db, CUSTOMER_ID, APPROVED_VENDOR_ID, null, "customer starts");
      await sendMessage(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        CUSTOMER_ID,
        "vendor replies",
      );

      await expect(markMessagesRead(
        db,
        OTHER_CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        CUSTOMER_ID,
      )).rejects.toThrow(/vendor_message_mark_read_forbidden/i);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.vendors
        SET status = 'rejected'
        WHERE id = '${APPROVED_VENDOR_ID}'
      `);
      await setPersona(db, "service_role");

      const customerAck = await markMessagesRead(
        db,
        CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        null,
      );
      expect(customerAck.rows).toEqual([{ marked_count: 1 }]);

      await expect(markMessagesRead(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        CUSTOMER_ID,
      )).rejects.toThrow(/vendor_message_mark_read_forbidden/i);

      const beforeRestore = await db.query<{
        content: string;
        is_read: boolean;
      }>(`
        SELECT content, is_read
        FROM public.vendor_messages
        WHERE server_provenance_version = 1
        ORDER BY created_at
      `);
      expect(beforeRestore.rows).toEqual([
        { content: "customer starts", is_read: false },
        { content: "vendor replies", is_read: true },
      ]);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.vendors
        SET status = 'approved'
        WHERE id = '${APPROVED_VENDOR_ID}'
      `);
      await setPersona(db, "service_role");

      const vendorAck = await markMessagesRead(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        CUSTOMER_ID,
      );
      expect(vendorAck.rows).toEqual([{ marked_count: 1 }]);
      const repeatedAck = await markMessagesRead(
        db,
        VENDOR_OWNER_ID,
        APPROVED_VENDOR_ID,
        CUSTOMER_ID,
      );
      expect(repeatedAck.rows).toEqual([{ marked_count: 0 }]);

      const legacyAck = await markMessagesRead(
        db,
        OTHER_CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        null,
      );
      expect(legacyAck.rows).toEqual([{ marked_count: 0 }]);
      const legacyRow = await db.query<{ is_read: boolean }>(`
        SELECT is_read
        FROM public.vendor_messages
        WHERE server_provenance_version IS NULL
      `);
      expect(legacyRow.rows).toEqual([{ is_read: false }]);

      const functionDefinition = await db.query<{ definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)'::regprocedure
        ) AS definition
      `);
      expect(functionDefinition.rows[0].definition).toContain("FOR SHARE");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("removes direct service-role writes and exposes write RPCs only to service_role", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      const privileges = await db.query<{
        service_insert: boolean;
        service_execute: boolean;
        authenticated_execute: boolean;
        anon_execute: boolean;
        authenticated_helper_execute: boolean;
        anon_helper_execute: boolean;
        service_helper_execute: boolean;
        service_mark_read_execute: boolean;
        authenticated_mark_read_execute: boolean;
        anon_mark_read_execute: boolean;
        empty_security_definer_search_paths: boolean;
        postgres_owned_security_definers: boolean;
        service_provenance_update: boolean;
        service_read_update: boolean;
      }>(`
        SELECT
          has_any_column_privilege(
            'service_role', 'public.vendor_messages', 'INSERT'
          ) AS service_insert,
          has_function_privilege(
            'service_role',
            'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS service_execute,
          has_function_privilege(
            'authenticated',
            'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'anon',
            'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS anon_execute,
          has_function_privilege(
            'authenticated',
            'public.is_approved_vendor_owner(uuid)',
            'EXECUTE'
          ) AS authenticated_helper_execute,
          has_function_privilege(
            'anon',
            'public.is_approved_vendor_owner(uuid)',
            'EXECUTE'
          ) AS anon_helper_execute,
          has_function_privilege(
            'service_role',
            'public.is_approved_vendor_owner(uuid)',
            'EXECUTE'
          ) AS service_helper_execute,
          has_function_privilege(
            'service_role',
            'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS service_mark_read_execute,
          has_function_privilege(
            'authenticated',
            'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS authenticated_mark_read_execute,
          has_function_privilege(
            'anon',
            'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS anon_mark_read_execute,
          (
            SELECT count(*) = 3
              AND bool_and('search_path=""' = ANY(function_record.proconfig))
            FROM pg_catalog.pg_proc AS function_record
            WHERE function_record.oid IN (
              'public.is_approved_vendor_owner(uuid)'::regprocedure,
              'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)'::regprocedure,
              'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)'::regprocedure
            )
          ) AS empty_security_definer_search_paths,
          (
            SELECT count(*) = 3
              AND bool_and(
                function_record.prosecdef
                AND function_owner.rolname = 'postgres'
              )
            FROM pg_catalog.pg_proc AS function_record
            JOIN pg_catalog.pg_roles AS function_owner
              ON function_owner.oid = function_record.proowner
            WHERE function_record.oid IN (
              'public.is_approved_vendor_owner(uuid)'::regprocedure,
              'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)'::regprocedure,
              'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)'::regprocedure
            )
          ) AS postgres_owned_security_definers,
          has_column_privilege(
            'service_role', 'public.vendor_messages',
            'server_provenance_version', 'UPDATE'
          ) AS service_provenance_update,
          has_column_privilege(
            'service_role', 'public.vendor_messages', 'is_read', 'UPDATE'
          ) AS service_read_update
      `);
      expect(privileges.rows[0]).toEqual({
        service_insert: false,
        service_execute: true,
        authenticated_execute: false,
        anon_execute: false,
        authenticated_helper_execute: true,
        anon_helper_execute: false,
        service_helper_execute: false,
        service_mark_read_execute: true,
        authenticated_mark_read_execute: false,
        anon_mark_read_execute: false,
        empty_security_definer_search_paths: true,
        postgres_owned_security_definers: true,
        service_provenance_update: false,
        service_read_update: false,
      });

      await setPersona(db, "service_role");
      await expect(db.exec(`
        INSERT INTO public.vendor_messages(
          vendor_id, customer_id, sender_type, content
        ) VALUES (
          '${APPROVED_VENDOR_ID}', '${CUSTOMER_ID}', 'customer', 'bypass'
        )
      `)).rejects.toThrow(/permission denied/i);

      await expect(db.exec(`
        UPDATE public.vendor_messages
        SET server_provenance_version = 1
        WHERE customer_id = '${OTHER_CUSTOMER_ID}'
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`
        UPDATE public.vendor_messages
        SET is_read = true
        WHERE customer_id = '${OTHER_CUSTOMER_ID}'
      `)).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "authenticated");
      await expect(sendMessage(
        db,
        CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        null,
        "direct rpc bypass",
      )).rejects.toThrow(/permission denied/i);
      await expect(markMessagesRead(
        db,
        CUSTOMER_ID,
        APPROVED_VENDOR_ID,
        null,
      )).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
