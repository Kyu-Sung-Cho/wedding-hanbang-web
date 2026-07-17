// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716094000_couple_roster_epoch.sql",
  ),
  "utf8",
);
const membershipMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714160000_harden_amora_privacy_boundaries.sql",
  ),
  "utf8",
);
const joinFunctionStart = membershipMigration.indexOf(
  "CREATE OR REPLACE FUNCTION public.join_couple(",
);
const joinFunctionEnd = membershipMigration.indexOf(
  "$function$;",
  joinFunctionStart,
) + "$function$;".length;
if (joinFunctionStart < 0 || joinFunctionEnd < "$function$;".length) {
  throw new Error("Unable to extract the canonical join_couple function");
}
const canonicalJoinFunction = membershipMigration.slice(
  joinFunctionStart,
  joinFunctionEnd,
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const THIRD_ID = "00000000-0000-4000-8000-000000000003";
const FOURTH_ID = "00000000-0000-4000-8000-000000000004";
const PAIRED_ID = "10000000-0000-4000-8000-000000000001";
const LEGACY_SINGLE_ID = "10000000-0000-4000-8000-000000000002";
const FRESH_SINGLE_ID = "10000000-0000-4000-8000-000000000003";
const EMPTY_ID = "10000000-0000-4000-8000-000000000004";
const JOIN_OWNER_ID = "00000000-0000-4000-8000-000000000011";
const JOIN_PARTNER_ID = "00000000-0000-4000-8000-000000000012";
const JOIN_THIRD_ID = "00000000-0000-4000-8000-000000000013";
const JOIN_COUPLE_ID = "10000000-0000-4000-8000-000000000011";
const MEMORY_JOB_A = "20000000-0000-4000-8000-000000000001";
const MEMORY_JOB_B = "20000000-0000-4000-8000-000000000002";
const CARE_ACTIVE_ID = "30000000-0000-4000-8000-000000000001";
const CARE_TERMINAL_ID = "30000000-0000-4000-8000-000000000002";

type FixtureVariant = "preview" | "fresh" | "unresolved";

async function createDatabase(variant: FixtureVariant) {
  const db = await PGlite.create();
  const careRosterColumn = variant === "fresh"
    ? `, roster_member_ids uuid[] NOT NULL
         CHECK (
           cardinality(roster_member_ids) BETWEEN 1 AND 2
           AND array_position(roster_member_ids, NULL) IS NULL
         )`
    : "";

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      invite_code text UNIQUE,
      bride_id uuid,
      groom_id uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id),
      role text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid,
      content text NOT NULL DEFAULT ''
    );

    CREATE TABLE public.amora_memory_jobs (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      visibility text NOT NULL DEFAULT 'shared',
      status text NOT NULL DEFAULT 'pending',
      attempt_count integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      claimed_at timestamptz,
      completed_at timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.amora_care_jobs (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
      content text NOT NULL,
      email_subject text,
      email_html text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      completed_at timestamptz,
      lease_token uuid,
      lease_expires_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
      ${careRosterColumn}
    );

    CREATE TABLE public.amora_care_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL REFERENCES public.amora_care_jobs(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped', 'expired', 'cancelled')),
      recipient_email text,
      recipient_name text,
      completed_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.couples (
      id, invite_code, bride_id, groom_id, created_at, updated_at
    ) VALUES
      ('${PAIRED_ID}', 'WH-PAIR01', '${BRIDE_ID}', '${GROOM_ID}',
        '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      ('${LEGACY_SINGLE_ID}', 'WH-LEGACY', '${BRIDE_ID}', NULL,
        '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z'),
      ('${FRESH_SINGLE_ID}', 'WH-FRESH1', NULL, '${GROOM_ID}',
        '2026-07-01T00:00:00Z', '2026-07-03T00:00:00Z'),
      ('${EMPTY_ID}', 'WH-EMPTY1', NULL, NULL,
        '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      ('${JOIN_COUPLE_ID}', 'WH-JOIN01', '${JOIN_OWNER_ID}', NULL,
        '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');

    INSERT INTO public.profiles (id, couple_id, role) VALUES
      ('${JOIN_OWNER_ID}', '${JOIN_COUPLE_ID}', 'bride'),
      ('${JOIN_PARTNER_ID}', NULL, 'groom'),
      ('${JOIN_THIRD_ID}', NULL, 'groom');

    -- Only LEGACY_SINGLE has durable evidence that two distinct people
    -- previously shared this couple. FRESH_SINGLE merely rotated its invite
    -- code, which also changes couples.updated_at and must not seal the roster.
    INSERT INTO public.chat_messages (couple_id, sender_id, content) VALUES
      ('${LEGACY_SINGLE_ID}', '${BRIDE_ID}', 'current member'),
      ('${LEGACY_SINGLE_ID}', '${GROOM_ID}', 'departed historical member');

    INSERT INTO public.amora_memory_jobs (id, couple_id, created_at) VALUES
      ('${MEMORY_JOB_A}', '${PAIRED_ID}', '2026-07-01T00:00:00Z'),
      ('${MEMORY_JOB_B}', '${PAIRED_ID}', '2026-07-02T00:00:00Z');
  `);
  await db.exec(canonicalJoinFunction);

  if (variant === "fresh") {
    await db.exec(`
      CREATE FUNCTION public.claim_amora_memory_job(
        p_lease_seconds integer DEFAULT 300,
        p_job_id uuid DEFAULT NULL
      ) RETURNS SETOF public.amora_memory_jobs
      LANGUAGE sql SECURITY DEFINER
      AS $$ SELECT * FROM public.amora_memory_jobs WHERE false $$;

      INSERT INTO public.amora_care_jobs (
        id, couple_id, status, content, email_subject, email_html, metadata,
        roster_member_ids
      ) VALUES (
        '${CARE_ACTIVE_ID}', '${PAIRED_ID}', 'pending', 'keep me', 'subject',
        '<p>body</p>', '{"source":"fresh"}',
        ARRAY['${BRIDE_ID}'::uuid, '${GROOM_ID}'::uuid]
      );
    `);
  } else {
    await db.exec(`
      CREATE FUNCTION public.claim_amora_memory_job(
        p_lease_seconds integer DEFAULT 300
      ) RETURNS SETOF public.amora_memory_jobs
      LANGUAGE sql SECURITY DEFINER
      AS $$ SELECT * FROM public.amora_memory_jobs WHERE false $$;
    `);

    const careCoupleId = variant === "unresolved" ? EMPTY_ID : PAIRED_ID;
    await db.exec(`
      INSERT INTO public.amora_care_jobs (
        id, couple_id, status, content, email_subject, email_html, metadata,
        completed_at
      ) VALUES
        ('${CARE_ACTIVE_ID}', '${careCoupleId}', 'processing', 'private active',
          'subject', '<p>active</p>', '{"private":true}', NULL),
        ('${CARE_TERMINAL_ID}', '${careCoupleId}', 'completed', 'old terminal',
          'old subject', '<p>old</p>', '{"old":true}', now());
      INSERT INTO public.amora_care_deliveries (
        job_id, status, recipient_email, recipient_name
      ) VALUES (
        '${CARE_ACTIVE_ID}', 'processing', 'person@example.com', 'Person'
      );
    `);
  }

  return db;
}

async function applyMigration(db: PGlite) {
  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
}

async function asService(db: PGlite) {
  await db.exec("SET ROLE service_role");
}

describe("couple roster epoch migration", () => {
  it("backfills only proven historical rosters and permanently closes a roster after the second join", async () => {
    const db = await createDatabase("preview");
    try {
      await applyMigration(db);
      const backfill = await db.query<{
        id: string;
        membership_sealed_at: string | null;
      }>(`
        SELECT id, membership_sealed_at
        FROM public.couples
        ORDER BY id
      `);
      expect(backfill.rows.map((row) => [row.id, Boolean(row.membership_sealed_at)])).toEqual([
        [PAIRED_ID, true],
        [LEGACY_SINGLE_ID, true],
        [FRESH_SINGLE_ID, false],
        [EMPTY_ID, false],
        [JOIN_COUPLE_ID, false],
      ]);

      await asService(db);
      await db.query(
        "UPDATE public.couples SET invite_code = 'WH-ROTATE' WHERE id = $1",
        [FRESH_SINGLE_ID],
      );
      await db.query(
        "UPDATE public.couples SET bride_id = $1 WHERE id = $2",
        [THIRD_ID, FRESH_SINGLE_ID],
      );
      const joined = await db.query<{
        invite_code: string;
        membership_sealed_at: string | null;
      }>(
        "SELECT invite_code, membership_sealed_at FROM public.couples WHERE id = $1",
        [FRESH_SINGLE_ID],
      );
      expect(joined.rows[0]?.invite_code).toBe("WH-ROTATE");
      expect(joined.rows[0]?.membership_sealed_at).not.toBeNull();

      await db.query(
        "UPDATE public.couples SET bride_id = NULL WHERE id = $1",
        [FRESH_SINGLE_ID],
      );
      await expect(
        db.query(
          "UPDATE public.couples SET bride_id = $1 WHERE id = $2",
          [FOURTH_ID, FRESH_SINGLE_ID],
        ),
      ).rejects.toThrow(/COUPLE_ROSTER_EPOCH_CLOSED/);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves canonical join idempotency while rejecting a third member after departure", async () => {
    const db = await createDatabase("fresh");
    try {
      await applyMigration(db);
      await db.exec("SET ROLE authenticated");
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
        JOIN_PARTNER_ID,
      ]);
      const joined = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.join_couple('WH-JOIN01', 'groom') AS result",
      );
      expect(joined.rows[0]?.result).toMatchObject({
        success: true,
        joined: true,
        idempotent: false,
        invite_code: "WH-JOIN01",
      });
      const retried = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.join_couple('WH-JOIN01', 'groom') AS result",
      );
      expect(retried.rows[0]?.result).toMatchObject({
        success: true,
        joined: false,
        idempotent: true,
        invite_code: "WH-JOIN01",
      });

      await db.exec("RESET ROLE");
      await db.query(
        "UPDATE public.couples SET groom_id = NULL WHERE id = $1",
        [JOIN_COUPLE_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = NULL WHERE id = $1",
        [JOIN_PARTNER_ID],
      );

      await db.exec("SET ROLE authenticated");
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
        JOIN_THIRD_ID,
      ]);
      await expect(
        db.query("SELECT public.join_couple('WH-JOIN01', 'groom')"),
      ).rejects.toThrow(/COUPLE_ROSTER_EPOCH_CLOSED/);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.query("SELECT set_config('request.jwt.claim.sub', '', false)").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("blocks member replacement, invite rotation, and unsealing even for service role", async () => {
    const db = await createDatabase("fresh");
    try {
      await applyMigration(db);
      await asService(db);
      await db.query(`
        INSERT INTO public.couples (
          id, invite_code, bride_id, groom_id, created_at, updated_at
        ) VALUES (
          '10000000-0000-4000-8000-000000000099', 'WH-NEW001',
          '${THIRD_ID}', NULL, now(), now()
        )
      `);
      await expect(db.query(`
        UPDATE public.couples
        SET bride_id = '${FOURTH_ID}'
        WHERE id = '10000000-0000-4000-8000-000000000099'
      `)).rejects.toThrow(/COUPLE_MEMBER_REPLACEMENT_FORBIDDEN/);
      await expect(db.query(`
        UPDATE public.couples
        SET bride_id = NULL, groom_id = '${FOURTH_ID}'
        WHERE id = '10000000-0000-4000-8000-000000000099'
      `)).rejects.toThrow(/COUPLE_MEMBER_REPLACEMENT_FORBIDDEN/);

      await expect(db.query(
        "UPDATE public.couples SET invite_code = 'WH-BLOCK1' WHERE id = $1",
        [PAIRED_ID],
      )).rejects.toThrow(/COUPLE_INVITE_CODE_SEALED/);
      await expect(db.query(
        "UPDATE public.couples SET membership_sealed_at = NULL WHERE id = $1",
        [PAIRED_ID],
      )).rejects.toThrow(/COUPLE_ROSTER_EPOCH_IMMUTABLE/);
      await expect(db.query(
        "UPDATE public.couples SET bride_id = $1 WHERE id = $2",
        [THIRD_ID, PAIRED_ID],
      )).rejects.toThrow(/COUPLE_ROSTER_EPOCH_CLOSED/);

      await db.query(
        "UPDATE public.couples SET groom_id = NULL WHERE id = $1",
        [PAIRED_ID],
      );
      const removed = await db.query<{ groom_id: string | null; invite_code: string }>(
        "SELECT groom_id, invite_code FROM public.couples WHERE id = $1",
        [PAIRED_ID],
      );
      expect(removed.rows[0]).toEqual({ groom_id: null, invite_code: "WH-PAIR01" });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("upgrades the targeted memory claim and quarantines pre-roster care jobs", async () => {
    const db = await createDatabase("preview");
    try {
      await applyMigration(db);
      const functions = await db.query<{
        old_claim: string | null;
        targeted_claim: string | null;
      }>(`
        SELECT
          to_regprocedure('public.claim_amora_memory_job(integer)')::text AS old_claim,
          to_regprocedure('public.claim_amora_memory_job(integer,uuid)')::text AS targeted_claim
      `);
      expect(functions.rows[0]?.old_claim).toBeNull();
      expect(functions.rows[0]?.targeted_claim).toContain("integer,uuid");

      await asService(db);
      const targeted = await db.query<{ id: string }>(
        "SELECT id FROM public.claim_amora_memory_job(300, $1)",
        [MEMORY_JOB_B],
      );
      expect(targeted.rows.map((row) => row.id)).toEqual([MEMORY_JOB_B]);

      const jobs = await db.query<{
        id: string;
        status: string;
        content: string;
        email_subject: string | null;
        metadata: Record<string, unknown>;
        roster_member_ids: string[];
      }>(`
        SELECT id, status, content, email_subject, metadata, roster_member_ids
        FROM public.amora_care_jobs
        ORDER BY id
      `);
      expect(jobs.rows).toEqual([
        expect.objectContaining({
          id: CARE_ACTIVE_ID,
          status: "cancelled",
          content: "[redacted]",
          email_subject: null,
          metadata: {},
          roster_member_ids: [BRIDE_ID, GROOM_ID],
        }),
        expect.objectContaining({
          id: CARE_TERMINAL_ID,
          status: "completed",
          content: "[redacted]",
          email_subject: null,
          metadata: {},
          roster_member_ids: [BRIDE_ID, GROOM_ID],
        }),
      ]);
      const delivery = await db.query<{
        status: string;
        recipient_email: string | null;
        recipient_name: string | null;
        last_error: string | null;
      }>(`
        SELECT status, recipient_email, recipient_name, last_error
        FROM public.amora_care_deliveries
      `);
      expect(delivery.rows[0]).toEqual({
        status: "cancelled",
        recipient_email: null,
        recipient_name: null,
        last_error: "roster_epoch_upgrade_quarantine",
      });

      const column = await db.query<{ is_nullable: string }>(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'amora_care_jobs'
          AND column_name = 'roster_member_ids'
      `);
      expect(column.rows[0]?.is_nullable).toBe("NO");
      await expect(db.query(`
        INSERT INTO public.amora_care_jobs (
          id, couple_id, status, content, metadata, roster_member_ids
        ) VALUES (
          gen_random_uuid(), '${PAIRED_ID}', 'pending', 'invalid', '{}', ARRAY[]::uuid[]
        )
      `)).rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("leaves already-hardened fresh-path care jobs active and valid", async () => {
    const db = await createDatabase("fresh");
    try {
      await applyMigration(db);
      const job = await db.query<{
        status: string;
        content: string;
        email_subject: string;
        metadata: Record<string, unknown>;
        roster_member_ids: string[];
      }>(`
        SELECT status, content, email_subject, metadata, roster_member_ids
        FROM public.amora_care_jobs
        WHERE id = $1
      `, [CARE_ACTIVE_ID]);
      expect(job.rows[0]).toEqual({
        status: "pending",
        content: "keep me",
        email_subject: "subject",
        metadata: { source: "fresh" },
        roster_member_ids: [BRIDE_ID, GROOM_ID],
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("aborts rather than inventing a roster for an unresolvable historical job", async () => {
    const db = await createDatabase("unresolved");
    try {
      await expect(applyMigration(db)).rejects.toThrow(
        /AMORA_CARE_ROSTER_BACKFILL_UNRESOLVED/,
      );
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
