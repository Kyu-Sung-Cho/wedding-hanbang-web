// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716104000_profile_patch_atomic.sql",
  ),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const JOB_ID = "20000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      name text,
      phone text,
      phone_care_consented_at timestamptz,
      care_notifications_enabled boolean NOT NULL DEFAULT false,
      care_notifications_consented_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT profiles_phone_format_check
        CHECK (phone IS NULL OR phone ~ '^01[016789][0-9]{7,8}$'),
      CONSTRAINT profiles_care_consent_state_valid
        CHECK (care_notifications_enabled = (care_notifications_consented_at IS NOT NULL))
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      badge text NOT NULL DEFAULT 'member',
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_community_profiles_nickname_key_unique
      ON public.community_profiles (
        lower(regexp_replace(btrim(nickname), '\\s+', '', 'g'))
      );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL,
      is_deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.amora_care_jobs (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      status text NOT NULL,
      content text NOT NULL,
      email_subject text,
      email_html text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      completed_at timestamptz,
      lease_token uuid,
      lease_expires_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_care_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL REFERENCES public.amora_care_jobs(id),
      status text NOT NULL,
      recipient_email text,
      recipient_name text,
      completed_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.prevent_direct_amora_care_consent_change()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $trigger$
    BEGIN
      IF current_user IN ('anon', 'authenticated')
         AND (
           NEW.care_notifications_enabled
             IS DISTINCT FROM OLD.care_notifications_enabled
           OR NEW.care_notifications_consented_at
             IS DISTINCT FROM OLD.care_notifications_consented_at
         ) THEN
        RAISE EXCEPTION 'AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN';
      END IF;
      RETURN NEW;
    END
    $trigger$;
    CREATE TRIGGER trg_prevent_direct_amora_care_consent_change
      BEFORE UPDATE OF care_notifications_enabled,
        care_notifications_consented_at
      ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_direct_amora_care_consent_change();

    INSERT INTO public.couples (id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${USER_ID}', '${OTHER_USER_ID}');
    INSERT INTO public.profiles (
      id, name, care_notifications_enabled, care_notifications_consented_at
    ) VALUES
      ('${USER_ID}', 'Old Name', false, NULL),
      ('${OTHER_USER_ID}', 'Other Person', false, NULL);
    INSERT INTO public.community_profiles (user_id, nickname)
    VALUES
      ('${USER_ID}', 'Old Name'),
      ('${OTHER_USER_ID}', 'Other Nickname');
  `);
  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  return db;
}

describe("atomic profile patch migration", () => {
  it("updates all requested profile fields and the current default nickname together", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role");
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          'New Name',
          '01012345678',
          true,
          true,
          true,
          'New Name',
          false
        ) AS value
      `);

      expect(result.rows[0]?.value).toMatchObject({
        profile: {
          id: USER_ID,
          name: "New Name",
          phone: "01012345678",
          care_notifications_enabled: true,
        },
        community_profile_synced: true,
        cancelled_jobs: 0,
      });
      await db.exec("RESET ROLE");
      const nickname = await db.query<{ nickname: string }>(
        "SELECT nickname FROM public.community_profiles WHERE user_id = $1",
        [USER_ID],
      );
      expect(nickname.rows[0]?.nickname).toBe("New Name");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("updates an independent community nickname without changing the profile name", async () => {
    const db = await createDatabase();
    try {
      const before = await db.query<{ updated_at: string }>(
        "SELECT updated_at FROM public.profiles WHERE id = $1",
        [USER_ID],
      );
      await db.exec("SET ROLE service_role");
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          NULL,
          NULL,
          false,
          NULL,
          NULL,
          'Independent Nick',
          false,
          true
        ) AS value
      `);
      expect(result.rows[0]?.value).toMatchObject({
        profile: { id: USER_ID, name: "Old Name" },
        community_profile_synced: true,
        community_nickname: "Independent Nick",
      });

      await db.exec("RESET ROLE");
      const state = await db.query<{
        name: string;
        updated_at: string;
        nickname: string;
      }>(`
        SELECT profile.name, profile.updated_at, community.nickname
        FROM public.profiles AS profile
        JOIN public.community_profiles AS community
          ON community.user_id = profile.id
        WHERE profile.id = '${USER_ID}'
      `);
      expect(state.rows[0]).toEqual({
        name: "Old Name",
        updated_at: before.rows[0]?.updated_at,
        nickname: "Independent Nick",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("allows execution only from the service role, never browser roles", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'anon',
            'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)',
            'EXECUTE'
          ) AS anon_execute,
          has_function_privilege(
            'authenticated',
            'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)',
            'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)',
            'EXECUTE'
          ) AS service_execute
      `);
      expect(privileges.rows[0]).toEqual({
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
      });

      await db.exec("SET ROLE authenticated");
      await expect(db.query(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          'Browser Write',
          NULL,
          false,
          NULL,
          NULL,
          'Browser Write',
          false
        )
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back the profile and nickname when a later queue scrub fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.profiles
        SET care_notifications_enabled = true,
            care_notifications_consented_at = now()
        WHERE id = '${USER_ID}';
        INSERT INTO public.amora_care_jobs (
          id, couple_id, status, content, email_subject, email_html, metadata
        ) VALUES (
          '${JOB_ID}', '${COUPLE_ID}', 'pending', 'private payload', 'subject',
          '<p>private</p>', '{"private":true}'::jsonb
        );
        INSERT INTO public.amora_care_deliveries (
          job_id, status, recipient_email, recipient_name
        ) VALUES (
          '${JOB_ID}', 'pending', 'person@example.com', 'Person'
        );
        CREATE FUNCTION public.fail_profile_patch_queue_scrub()
        RETURNS trigger LANGUAGE plpgsql AS $trigger$
        BEGIN
          IF NEW.status = 'cancelled' THEN
            RAISE EXCEPTION 'forced_queue_scrub_failure';
          END IF;
          RETURN NEW;
        END
        $trigger$;
        CREATE TRIGGER fail_profile_patch_queue_scrub
          BEFORE UPDATE ON public.amora_care_jobs
          FOR EACH ROW EXECUTE FUNCTION public.fail_profile_patch_queue_scrub();
      `);
      await db.exec("SET ROLE service_role");

      await expect(db.query(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          'Rolled Back',
          NULL,
          false,
          NULL,
          false,
          'Rolled Back',
          false
        )
      `)).rejects.toThrow(/forced_queue_scrub_failure/);

      await db.exec("RESET ROLE");
      const state = await db.query<{
        name: string;
        care_notifications_enabled: boolean;
        care_notifications_consented_at: string | null;
        nickname: string;
        job_status: string;
        content: string;
        recipient_email: string | null;
      }>(`
        SELECT profile.name,
               profile.care_notifications_enabled,
               profile.care_notifications_consented_at,
               community.nickname,
               job.status AS job_status,
               job.content,
               delivery.recipient_email
        FROM public.profiles AS profile
        JOIN public.community_profiles AS community
          ON community.user_id = profile.id
        JOIN public.amora_care_jobs AS job
          ON job.couple_id = '${COUPLE_ID}'
        JOIN public.amora_care_deliveries AS delivery
          ON delivery.job_id = job.id
        WHERE profile.id = '${USER_ID}'
      `);
      expect(state.rows[0]).toMatchObject({
        name: "Old Name",
        care_notifications_enabled: true,
        nickname: "Old Name",
        job_status: "pending",
        content: "private payload",
        recipient_email: "person@example.com",
      });
      expect(state.rows[0]?.care_notifications_consented_at).not.toBeNull();
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("cancels and scrubs active care work when consent is withdrawn", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.profiles
        SET care_notifications_enabled = true,
            care_notifications_consented_at = now()
        WHERE id = '${USER_ID}';
        INSERT INTO public.amora_care_jobs (
          id, couple_id, status, content, email_subject, email_html, metadata
        ) VALUES (
          '${JOB_ID}', '${COUPLE_ID}', 'processing', 'private payload', 'subject',
          '<p>private</p>', '{"private":true}'::jsonb
        );
        INSERT INTO public.amora_care_deliveries (
          job_id, status, recipient_email, recipient_name
        ) VALUES (
          '${JOB_ID}', 'processing', 'person@example.com', 'Person'
        );
      `);
      await db.exec("SET ROLE service_role");
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          NULL,
          NULL,
          false,
          NULL,
          false,
          NULL,
          false
        ) AS value
      `);
      expect(result.rows[0]?.value).toMatchObject({
        profile: {
          id: USER_ID,
          care_notifications_enabled: false,
          care_notifications_consented_at: null,
        },
        community_profile_synced: false,
        cancelled_jobs: 1,
      });

      await db.exec("RESET ROLE");
      const scrubbed = await db.query<{
        job_status: string;
        content: string;
        email_subject: string | null;
        email_html: string | null;
        metadata: Record<string, unknown>;
        lease_token: string | null;
        delivery_status: string;
        recipient_email: string | null;
        recipient_name: string | null;
        delivery_error: string | null;
      }>(`
        SELECT job.status AS job_status,
               job.content,
               job.email_subject,
               job.email_html,
               job.metadata,
               job.lease_token,
               delivery.status AS delivery_status,
               delivery.recipient_email,
               delivery.recipient_name,
               delivery.last_error AS delivery_error
        FROM public.amora_care_jobs AS job
        JOIN public.amora_care_deliveries AS delivery
          ON delivery.job_id = job.id
        WHERE job.id = '${JOB_ID}'
      `);
      expect(scrubbed.rows[0]).toEqual({
        job_status: "cancelled",
        content: "[redacted]",
        email_subject: null,
        email_html: null,
        metadata: {},
        lease_token: null,
        delivery_status: "cancelled",
        recipient_email: null,
        recipient_name: null,
        delivery_error: "consent_withdrawn",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("locks active care jobs before the profile on the withdrawal path", async () => {
    const db = await createDatabase();
    try {
      const definition = await db.query<{ source: string }>(`
        SELECT pg_get_functiondef(
          'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)'::regprocedure
        ) AS source
      `);
      const source = definition.rows[0]?.source ?? "";
      const jobsLock = source.indexOf("FROM public.amora_care_jobs");
      const profileLock = source.indexOf("FROM public.profiles");
      expect(jobsLock).toBeGreaterThan(-1);
      expect(profileLock).toBeGreaterThan(jobsLock);
    } finally {
      await db.close();
    }
  });

  it("creates a missing community profile on an explicit nickname sync", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        DELETE FROM public.community_profiles WHERE user_id = '${USER_ID}';
        INSERT INTO public.community_posts (author_id, visibility, under_review) VALUES
          ('${USER_ID}', 'public', false),
          ('${USER_ID}', 'members', false),
          ('${USER_ID}', 'draft', false),
          ('${USER_ID}', 'public', true);
        INSERT INTO public.community_comments (author_id, is_deleted) VALUES
          ('${USER_ID}', false),
          ('${USER_ID}', true);
      `);
      await db.exec("SET ROLE service_role");
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          'Created Name',
          NULL,
          false,
          NULL,
          NULL,
          'Created Name',
          true
        ) AS value
      `);
      expect(result.rows[0]?.value).toMatchObject({
        profile: { id: USER_ID, name: "Created Name" },
        community_profile_synced: true,
      });

      await db.exec("RESET ROLE");
      const created = await db.query<{
        nickname: string;
        badge: string;
        post_count: number;
        comment_count: number;
        total_upvotes_received: number;
      }>(`
        SELECT nickname, badge, post_count, comment_count,
               total_upvotes_received
        FROM public.community_profiles
        WHERE user_id = '${USER_ID}'
      `);
      expect(created.rows[0]).toEqual({
        nickname: "Created Name",
        badge: "member",
        post_count: 2,
        comment_count: 1,
        total_upvotes_received: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back a simultaneous name change when the explicit nickname loses a race", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        "UPDATE public.community_profiles SET nickname = 'TakenName' WHERE user_id = $1",
        [OTHER_USER_ID],
      );
      await db.exec("SET ROLE service_role");
      await expect(db.query(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          'New Legal Name',
          NULL,
          false,
          NULL,
          NULL,
          'taken name',
          false,
          true
        )
      `)).rejects.toThrow(/duplicate key|unique constraint/i);

      await db.exec("RESET ROLE");
      const unchanged = await db.query<{ name: string; nickname: string }>(`
        SELECT profile.name, community.nickname
        FROM public.profiles AS profile
        JOIN public.community_profiles AS community
          ON community.user_id = profile.id
        WHERE profile.id = '${USER_ID}'
      `);
      expect(unchanged.rows[0]).toEqual({
        name: "Old Name",
        nickname: "Old Name",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("does not overwrite a nickname based on a stale previous profile name", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.profiles
        SET name = 'Server Current'
        WHERE id = '${USER_ID}';
        UPDATE public.community_profiles
        SET nickname = 'Client Stale Name'
        WHERE user_id = '${USER_ID}';
      `);
      await db.exec("SET ROLE service_role");
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          'Next Name',
          NULL,
          false,
          NULL,
          NULL,
          'Next Name',
          false
        ) AS value
      `);
      expect(result.rows[0]?.value).toMatchObject({
        profile: { id: USER_ID, name: "Next Name" },
        community_profile_synced: false,
      });

      await db.exec("RESET ROLE");
      const nickname = await db.query<{ nickname: string }>(
        "SELECT nickname FROM public.community_profiles WHERE user_id = $1",
        [USER_ID],
      );
      expect(nickname.rows[0]?.nickname).toBe("Client Stale Name");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("checks phone consent against the locked current profile", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role");
      await expect(db.query(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          NULL,
          NULL,
          false,
          true,
          NULL,
          NULL,
          false
        )
      `)).rejects.toThrow(/PROFILE_PATCH_PHONE_REQUIRED/);

      await db.exec("RESET ROLE");
      await db.query(
        "UPDATE public.profiles SET phone = '01012345678' WHERE id = $1",
        [USER_ID],
      );
      await db.exec("SET ROLE service_role");
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.patch_profile_atomic(
          '${USER_ID}'::uuid,
          NULL,
          NULL,
          false,
          true,
          NULL,
          NULL,
          false
        ) AS value
      `);
      expect(result.rows[0]?.value).toMatchObject({
        profile: {
          id: USER_ID,
          phone: "01012345678",
        },
      });
      expect(
        (result.rows[0]?.value.profile as Record<string, unknown>)
          .phone_care_consented_at,
      ).toEqual(expect.any(String));
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });
});
