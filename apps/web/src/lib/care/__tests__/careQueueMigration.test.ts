// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716093000_amora_care_queue.sql"),
  "utf8",
);
const deliveryPolicyUpgrade = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716095000_amora_care_delivery_policy.sql"),
  "utf8",
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const REPLACEMENT_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const JOURNEY_ID = "20000000-0000-4000-8000-000000000001";

async function createDatabase(deliveryClock = "2099-07-16 10:00:00+09") {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '${BRIDE_ID}'::uuid $$;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz
    );
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      email text,
      name text,
      care_notifications_enabled boolean NOT NULL DEFAULT false,
      care_notifications_consented_at timestamptz
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id),
      wedding_date date,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      sender_role text,
      specialist_type text,
      stage_tag text,
      visibility text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX chat_messages_client_request_id_unique
      ON public.chat_messages (couple_id, (metadata->>'client_request_id'))
      WHERE metadata->>'client_request_id' IS NOT NULL;
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY chat_messages_insert_own_user ON public.chat_messages FOR INSERT
      TO authenticated
      WITH CHECK (
        sender_id = auth.uid()
        AND role = 'user'
        AND sender_type = 'bride'
        AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'client_request_id')
      );
    CREATE POLICY chat_insert_couple ON public.chat_messages FOR INSERT
      TO authenticated
      WITH CHECK (sender_id = auth.uid());

    INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
      ('${BRIDE_ID}', 'bride-auth@example.com', now()),
      ('${GROOM_ID}', 'groom-auth@example.com', now());
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(
      id, email, name, care_notifications_enabled, care_notifications_consented_at
    ) VALUES
      ('${BRIDE_ID}', 'bride@example.com', 'Bride', true, now()),
      ('${GROOM_ID}', 'groom@example.com', 'Groom', true, now());
    INSERT INTO public.wedding_journeys(couple_id) VALUES ('${COUPLE_ID}');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
    GRANT SELECT ON public.couples TO authenticated;
    GRANT SELECT, UPDATE ON public.profiles TO authenticated;
  `);
  await db.exec(migration);
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.amora_care_delivery_clock()
    RETURNS timestamptz
    LANGUAGE sql
    STABLE
    AS $$ SELECT TIMESTAMPTZ '${deliveryClock}' $$;
  `);
  return db;
}

async function asService(db: PGlite) {
  await db.exec("SET ROLE service_role");
}

async function setDeliveryClock(db: PGlite, value = "2099-07-16 10:00:00+09") {
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.amora_care_delivery_clock()
    RETURNS timestamptz
    LANGUAGE sql
    STABLE
    AS $$ SELECT TIMESTAMPTZ '${value}' $$;
  `);
}

async function enqueue(db: PGlite, suffix = "one") {
  return db.query<{ result: Record<string, unknown> }>(
    `SELECT public.enqueue_amora_care_job(
       $1, DATE '2099-07-16', $2, '오늘 확인할 일정이 있어요.',
       jsonb_build_object('moment', jsonb_build_object('momentType', 'dress')),
       '저장된 제목', '<p>저장된 본문</p>'
     ) AS result`,
    [COUPLE_ID, `dress:d1:2099-07-${suffix}`],
  );
}

describe("durable Amora outbound-care queue migration", () => {
  it("keeps the convergence migration off long-lived ACCESS EXCLUSIVE locks", () => {
    expect(deliveryPolicyUpgrade).not.toMatch(
      /LOCK TABLE public\.(?:profiles|amora_care_jobs|amora_care_deliveries) IN ACCESS EXCLUSIVE MODE/,
    );
    expect(deliveryPolicyUpgrade).not.toContain("LOCK TABLE public.profiles");
    expect(deliveryPolicyUpgrade).toContain(
      "LOCK TABLE public.amora_care_jobs IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(deliveryPolicyUpgrade).toContain(
      "DO $add_send_day_only_when_missing$",
    );
  });

  it("defines the KST delivery window as 09:00 inclusive and 20:00 exclusive", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const result = await db.query<{
        before: boolean;
        opens: boolean;
        before_close: boolean;
        closes: boolean;
      }>(`
        SELECT
          public.amora_care_is_delivery_window(TIMESTAMPTZ '2099-07-15 08:59:59+09') AS before,
          public.amora_care_is_delivery_window(TIMESTAMPTZ '2099-07-15 09:00:00+09') AS opens,
          public.amora_care_is_delivery_window(TIMESTAMPTZ '2099-07-15 19:59:59+09') AS before_close,
          public.amora_care_is_delivery_window(TIMESTAMPTZ '2099-07-15 20:00:00+09') AS closes
      `);
      expect(result.rows[0]).toEqual({
        before: false,
        opens: true,
        before_close: true,
        closes: false,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("defers a pre-09:00 job in the DB without creating chat or email deliveries", async () => {
    const db = await createDatabase("2099-07-16 08:59:00+09");
    try {
      await asService(db);
      const enqueued = await enqueue(db, "pre-window");
      const jobId = String(enqueued.rows[0]?.result.id);
      const prematureClaim = await db.query<{ result: Record<string, unknown> | null }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [jobId],
      );
      expect(prematureClaim.rows[0]?.result).toBeNull();
      const queued = await db.query<{ available_at: string; last_error: string }>(`
        SELECT available_at::text, last_error
        FROM public.amora_care_jobs
        WHERE id = $1
      `, [jobId]);
      expect(new Date(queued.rows[0]!.available_at).toISOString())
        .toBe("2099-07-16T00:00:00.000Z");
      expect(queued.rows[0]?.last_error).toBe("outside_delivery_window");

      // Force a targeted/racing claim to prove prepare independently repeats
      // the DB fence instead of relying only on available_at scheduling.
      await db.query(
        "UPDATE public.amora_care_jobs SET available_at = now() WHERE id = $1",
        [jobId],
      );
      const claim = await db.query<{ result: { lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [jobId],
      );
      const prepared = await db.query<{
        result: { state: string; reason: string; available_at: string };
      }>(
        "SELECT public.prepare_amora_care_job($1, $2, true) AS result",
        [jobId, claim.rows[0]?.result.lease_token],
      );

      expect(prepared.rows[0]?.result).toMatchObject({
        state: "deferred",
        reason: "outside_delivery_window",
      });
      expect(new Date(prepared.rows[0]!.result.available_at).toISOString())
        .toBe("2099-07-16T00:00:00.000Z");
      const state = await db.query<{
        status: string;
        attempt_count: number;
        messages: number;
        deliveries: number;
      }>(`
        SELECT job.status, job.attempt_count,
               (SELECT count(*)::integer FROM public.chat_messages) AS messages,
               (SELECT count(*)::integer FROM public.amora_care_deliveries) AS deliveries
        FROM public.amora_care_jobs AS job
        WHERE job.id = $1
      `, [jobId]);
      expect(state.rows[0]).toEqual({
        status: "pending",
        attempt_count: 0,
        messages: 0,
        deliveries: 0,
      });
      const stats = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.get_amora_care_queue_stats(DATE '2099-07-16') AS result",
      );
      expect(stats.rows[0]?.result).toMatchObject({
        failed: 0,
        active_backlog: 1,
        deferred: 1,
        frequency_skipped: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not prepare any new outbound care at or after 20:00 KST", async () => {
    const db = await createDatabase("2099-07-16 20:00:00+09");
    try {
      await asService(db);
      const enqueued = await enqueue(db, "closed-window");
      const jobId = String(enqueued.rows[0]?.result.id);
      expect(enqueued.rows[0]?.result).toMatchObject({ status: "expired" });
      const claim = await db.query<{ result: Record<string, unknown> | null }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [jobId],
      );
      expect(claim.rows[0]?.result).toBeNull();
      const counts = await db.query<{ messages: number; deliveries: number }>(`
        SELECT (SELECT count(*)::integer FROM public.chat_messages) AS messages,
               (SELECT count(*)::integer FROM public.amora_care_deliveries) AS deliveries
      `);
      expect(counts.rows[0]).toEqual({ messages: 0, deliveries: 0 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("enforces one concurrency-safe email reservation per authenticated user and KST day", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const first = await enqueue(db, "daily-first");
      const second = await enqueue(db, "daily-second");
      const firstId = String(first.rows[0]?.result.id);
      const secondId = String(second.rows[0]?.result.id);
      const firstClaim = await db.query<{ result: { lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [firstId],
      );
      const secondClaim = await db.query<{ result: { lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [secondId],
      );
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [
        firstId,
        firstClaim.rows[0]?.result.lease_token,
      ]);
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [
        secondId,
        secondClaim.rows[0]?.result.lease_token,
      ]);

      const [firstDelivery, secondDelivery] = await Promise.all([
        db.query<{ result: { state: string; user_id: string } }>(
          "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
          [firstId, firstClaim.rows[0]?.result.lease_token],
        ),
        db.query<{ result: { state: string; reason?: string } }>(
          "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
          [secondId, secondClaim.rows[0]?.result.lease_token],
        ),
      ]);

      expect(firstDelivery.rows[0]?.result).toMatchObject({ state: "ready", user_id: BRIDE_ID });
      expect(secondDelivery.rows[0]?.result).toMatchObject({
        state: "skipped",
        reason: "daily_frequency_limit",
      });
      const durable = await db.query<{
        reservations: number;
        frequency_skipped: number;
        chat_messages: number;
      }>(`
        SELECT
          count(*) FILTER (WHERE user_id = $1 AND send_day = DATE '2099-07-16')::integer
            AS reservations,
          count(*) FILTER (WHERE last_error = 'daily_frequency_limit')::integer
            AS frequency_skipped,
          (SELECT count(*)::integer FROM public.chat_messages) AS chat_messages
        FROM public.amora_care_deliveries
      `, [BRIDE_ID]);
      expect(durable.rows[0]).toEqual({
        reservations: 1,
        frequency_skipped: 1,
        chat_messages: 2,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("makes consent boolean and timestamp equivalent at the database boundary", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await expect(db.query(`
        UPDATE public.profiles
        SET care_notifications_enabled = false,
            care_notifications_consented_at = now()
        WHERE id = $1
      `, [BRIDE_ID])).rejects.toThrow(/profiles_care_consent_state_valid/i);
      await expect(db.query(`
        UPDATE public.profiles
        SET care_notifications_enabled = true,
            care_notifications_consented_at = NULL
        WHERE id = $1
      `, [BRIDE_ID])).rejects.toThrow(/profiles_care_consent_state_valid/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("includes claim-time terminal failures in the queue health snapshot", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const enqueued = await enqueue(db, "terminal-claim");
      const jobId = String(enqueued.rows[0]?.result.id);
      await db.query(
        "UPDATE public.amora_care_jobs SET attempt_count = 5 WHERE id = $1",
        [jobId],
      );
      const claim = await db.query<{ result: Record<string, unknown> | null }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [jobId],
      );
      expect(claim.rows[0]?.result).toBeNull();
      const stats = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.get_amora_care_queue_stats(DATE '2099-07-16') AS result",
      );
      expect(stats.rows[0]?.result).toMatchObject({
        failed: 1,
        active_backlog: 0,
        oldest_active_age_seconds: 0,
        deferred: 0,
        frequency_skipped: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("quarantines an already-applied preview queue and converges on the same policy", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const oldJob = await enqueue(db, "pre-policy-active");
      const oldJobId = String(oldJob.rows[0]?.result.id);
      const oldClaim = await db.query<{ result: { lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [oldJobId],
      );
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [
        oldJobId,
        oldClaim.rows[0]?.result.lease_token,
      ]);
      await db.query("SELECT public.claim_amora_care_email_delivery($1, $2)", [
        oldJobId,
        oldClaim.rows[0]?.result.lease_token,
      ]);
      // The convergence migration derives the conservative reservation day
      // from the legacy attempt timestamp. Keep that day fixed so this test
      // does not become dependent on whether the suite runs before or after
      // the real-world 20:00 KST delivery cutoff.
      await db.query(`
        UPDATE public.amora_care_deliveries
        SET claimed_at = TIMESTAMPTZ '2099-07-16 10:00:00+09'
        WHERE job_id = $1
      `, [oldJobId]);

      await db.exec("RESET ROLE");
      // Simulate a preview database that recorded the earlier 0930 before the
      // send-day column/index were added to the migration source.
      await db.exec(`
        DROP INDEX public.amora_care_deliveries_user_send_day_uidx;
        ALTER TABLE public.amora_care_deliveries DROP COLUMN send_day;
        CREATE OR REPLACE FUNCTION public.claim_amora_care_email_delivery(
          p_job_id uuid,
          p_lease_token uuid
        )
        RETURNS jsonb
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog, public
        AS $legacy$
        DECLARE
          v_delivery public.amora_care_deliveries%ROWTYPE;
          v_email text;
        BEGIN
          SELECT * INTO v_delivery
          FROM public.amora_care_deliveries
          WHERE job_id = p_job_id AND status = 'pending'
          ORDER BY user_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1;
          IF NOT FOUND THEN
            RETURN NULL;
          END IF;
          SELECT email INTO v_email
          FROM auth.users
          WHERE id = v_delivery.user_id AND email_confirmed_at IS NOT NULL;
          UPDATE public.amora_care_deliveries
          SET status = 'processing', attempt_count = attempt_count + 1,
              claimed_at = now(), recipient_email = v_email, updated_at = now()
          WHERE id = v_delivery.id;
          RETURN jsonb_build_object(
            'state', 'ready',
            'id', v_delivery.id,
            'user_id', v_delivery.user_id,
            'email', v_email,
            'idempotency_key', v_delivery.idempotency_key
          );
        END
        $legacy$;
      `);
      await db.exec(deliveryPolicyUpgrade);
      const quarantined = await db.query<{
        status: string;
        content: string;
        active_deliveries: number;
        recipient_pii: number;
        reservations: number;
        reservation_day: string | null;
      }>(`
        SELECT job.status, job.content,
               count(*) FILTER (
                 WHERE delivery.status IN ('pending', 'processing')
               )::integer AS active_deliveries,
               count(*) FILTER (
                 WHERE delivery.recipient_email IS NOT NULL
                    OR delivery.recipient_name IS NOT NULL
               )::integer AS recipient_pii,
               count(*) FILTER (
                 WHERE delivery.user_id = $2 AND delivery.send_day IS NOT NULL
               )::integer AS reservations,
               (max(delivery.send_day) FILTER (
                 WHERE delivery.user_id = $2
               ))::text AS reservation_day
        FROM public.amora_care_jobs AS job
        JOIN public.amora_care_deliveries AS delivery ON delivery.job_id = job.id
        WHERE job.id = $1
        GROUP BY job.id, job.status, job.content
      `, [oldJobId, BRIDE_ID]);
      expect(quarantined.rows[0]).toEqual({
        status: "cancelled",
        content: "[redacted]",
        active_deliveries: 0,
        recipient_pii: 0,
        reservations: 1,
        reservation_day: expect.any(String),
      });

      const reservationDay = quarantined.rows[0]?.reservation_day;
      expect(reservationDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await setDeliveryClock(db, `${reservationDay} 10:00:00+09`);
      await asService(db);
      const newJob = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.enqueue_amora_care_job(
           $1, $2::date, 'post-policy', '정책 업그레이드 후 케어', '{}'::jsonb,
           '업그레이드 후 제목', '<p>업그레이드 후 본문</p>'
         ) AS result`,
        [COUPLE_ID, reservationDay],
      );
      const newJobId = String(newJob.rows[0]?.result.id);
      const newClaim = await db.query<{ result: { lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [newJobId],
      );
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [
        newJobId,
        newClaim.rows[0]?.result.lease_token,
      ]);
      const delivery = await db.query<{ result: { state: string; reason: string } }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [newJobId, newClaim.rows[0]?.result.lease_token],
      );
      expect(delivery.rows[0]?.result).toMatchObject({
        state: "skipped",
        reason: "daily_frequency_limit",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is service-role-only and uses leased SKIP LOCKED claims", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE authenticated");
      await expect(db.query("SELECT public.claim_amora_care_job(90)")).rejects.toThrow(/permission denied/i);
      await expect(db.query("SELECT * FROM public.amora_care_jobs")).rejects.toThrow(/permission denied/i);
      await db.exec("RESET ROLE");
      await asService(db);
      const definitions = await db.query<{ proname: string; prosrc: string }>(`
        SELECT p.proname, p.prosrc
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'claim_amora_care_scan', 'claim_amora_care_job',
            'claim_amora_care_email_delivery'
          )
        ORDER BY p.proname
      `);
      expect(definitions.rows).toHaveLength(3);
      for (const definition of definitions.rows) {
        expect(definition.prosrc, definition.proname).toMatch(/FOR UPDATE SKIP LOCKED/i);
      }
      const privileges = await db.query<{
        proname: string;
        anonymous: boolean;
        authenticated: boolean;
      }>(`
        SELECT p.proname,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anonymous,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'claim_amora_care_scan', 'advance_amora_care_scan',
            'enqueue_amora_care_job', 'claim_amora_care_job',
            'prepare_amora_care_job', 'claim_amora_care_email_delivery',
            'finish_amora_care_email_delivery', 'finish_amora_care_job',
            'set_amora_care_consent', 'quarantine_amora_care_queue',
            'get_amora_care_queue_stats', 'amora_care_delivery_clock',
            'amora_care_is_delivery_window', 'amora_care_next_delivery_window'
          )
        ORDER BY p.proname
      `);
      expect(privileges.rows).toHaveLength(14);
      expect(privileges.rows.every((row) => !row.anonymous && !row.authenticated)).toBe(true);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("prevents authenticated members from forging AI or reserved idempotency messages", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE authenticated");
      await expect(db.query(`
        INSERT INTO public.chat_messages(
          couple_id, sender_id, sender_type, role, content, visibility, metadata
        ) VALUES (
          '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', '정상 메시지', 'shared', '{}'::jsonb
        )
      `)).resolves.toBeDefined();
      await expect(db.query(`
        INSERT INTO public.chat_messages(
          couple_id, sender_id, sender_type, role, content, visibility, metadata
        ) VALUES (
          '${COUPLE_ID}', '${BRIDE_ID}', 'ai', 'assistant', '위조 메시지', 'shared',
          '{"client_request_id":"moment:predictable"}'::jsonb
        )
      `)).rejects.toThrow(/row-level security/i);
      await db.exec("RESET ROLE");
      const policies = await db.query<{ policyname: string }>(`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'chat_messages'
        ORDER BY policyname
      `);
      expect(policies.rows).toEqual([{ policyname: "chat_messages_insert_own_user" }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps a durable monotonic KST scan cursor across crash-safe page retries", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const first = await db.query<{
        result: {
          lease_token: string;
          last_couple_id: string | null;
          last_journey_id: string | null;
          snapshot_at: string;
        };
      }>(
        "SELECT public.claim_amora_care_scan(DATE '2099-07-16', 90) AS result",
      );
      const token = first.rows[0]?.result.lease_token;
      expect(token).toMatch(/[0-9a-f-]{36}/i);
      expect(first.rows[0]?.result.last_couple_id).toBeNull();
      expect(first.rows[0]?.result.last_journey_id).toBeNull();
      expect(first.rows[0]?.result.snapshot_at).toBeTruthy();

      await db.query(
        "SELECT public.advance_amora_care_scan(DATE '2099-07-16', $1, $2, $3, 1, false)",
        [token, COUPLE_ID, JOURNEY_ID],
      );
      await expect(db.query(
        "SELECT public.advance_amora_care_scan(DATE '2099-07-16', $1, $2, $3, 1, false)",
        [token, COUPLE_ID, JOURNEY_ID],
      )).rejects.toThrow(/CURSOR_NOT_MONOTONIC/);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("deduplicates enqueue and claims distinct jobs with bounded leases", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await expect(db.query(
        `SELECT public.enqueue_amora_care_job(
           $1, DATE '2099-07-16', 'oversized', repeat('x', 2001), '{}'::jsonb
         )`,
        [COUPLE_ID],
      )).rejects.toThrow(/AMORA_CARE_JOB_INVALID/);
      const first = await enqueue(db, "16");
      const duplicate = await enqueue(db, "16");
      expect(new Date(String(first.rows[0]?.result.expires_at)).toISOString())
        .toBe("2099-07-16T11:00:00.000Z");
      expect(duplicate.rows[0]?.result.id).toBe(first.rows[0]?.result.id);
      expect(duplicate.rows[0]?.result.inserted).toBe(false);
      await enqueue(db, "17");

      const [claimA, claimB] = await Promise.all([
        db.query<{ result: { id: string } }>("SELECT public.claim_amora_care_job(90) AS result"),
        db.query<{ result: { id: string } }>("SELECT public.claim_amora_care_job(90) AS result"),
      ]);
      expect(claimA.rows[0]?.result.id).not.toBe(claimB.rows[0]?.result.id);
      const state = await db.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM public.amora_care_jobs ORDER BY id",
      );
      expect(state.rows.every((row) => row.status === "processing" && row.attempt_count === 1)).toBe(true);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("can atomically claim only the explicitly targeted synthetic job", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const unrelated = await enqueue(db, "unrelated");
      const target = await enqueue(db, "target");
      const targetId = String(target.rows[0]?.result.id);

      const claimed = await db.query<{ result: { id: string } }>(
        "SELECT public.claim_amora_care_job(90, $1) AS result",
        [targetId],
      );
      expect(claimed.rows[0]?.result.id).toBe(targetId);

      const untouched = await db.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM public.amora_care_jobs WHERE id = $1",
        [unrelated.rows[0]?.result.id],
      );
      expect(untouched.rows[0]).toEqual({ status: "pending", attempt_count: 0 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a member-forged row that preclaims a care idempotency key", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await enqueue(db, "forged");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      await db.query(`
        INSERT INTO public.chat_messages(
          couple_id, sender_id, sender_type, role, content, visibility, metadata
        ) VALUES (
          $1, $2, 'bride', 'user', '위조 선점', 'shared',
          jsonb_build_object('client_request_id', 'moment:dress:d1:2099-07-forged')
        )
      `, [COUPLE_ID, BRIDE_ID]);

      await expect(db.query(
        "SELECT public.prepare_amora_care_job($1, $2, true)",
        [claim.rows[0]?.result.id, claim.rows[0]?.result.lease_token],
      )).rejects.toThrow(/AMORA_CARE_CHAT_IDEMPOTENCY/);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("cancels terminally when unanimous consent is withdrawn after enqueue", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await enqueue(db, "16");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      await db.query(
        "UPDATE public.profiles SET care_notifications_enabled = false, care_notifications_consented_at = NULL WHERE id = $1",
        [GROOM_ID],
      );
      const prepared = await db.query<{ result: { state: string } }>(
        "SELECT public.prepare_amora_care_job($1, $2, true) AS result",
        [claim.rows[0]?.result.id, claim.rows[0]?.result.lease_token],
      );
      expect(prepared.rows[0]?.result.state).toBe("cancelled");
      const counts = await db.query<{ messages: number; deliveries: number }>(`
        SELECT (SELECT count(*)::integer FROM public.chat_messages) AS messages,
               (SELECT count(*)::integer FROM public.amora_care_deliveries) AS deliveries
      `);
      expect(counts.rows[0]).toEqual({ messages: 0, deliveries: 0 });
      const cancelledJob = await db.query<{
        content: string;
        email_subject: string | null;
        email_html: string | null;
        metadata: Record<string, unknown>;
      }>(`
        SELECT content, email_subject, email_html, metadata
        FROM public.amora_care_jobs
        WHERE id = $1
      `, [claim.rows[0]?.result.id]);
      expect(cancelledJob.rows[0]).toEqual({
        content: "[redacted]",
        email_subject: null,
        email_html: null,
        metadata: {},
  });

    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("forces authenticated consent changes through the atomic service RPC", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE authenticated");
      await expect(db.query(
        `UPDATE public.profiles
         SET care_notifications_enabled = false,
             care_notifications_consented_at = NULL
         WHERE id = $1`,
        [BRIDE_ID],
      )).rejects.toThrow(/AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN/i);

      await db.exec("RESET ROLE");
      await asService(db);
      const before = await db.query<{ enabled: boolean }>(
        "SELECT care_notifications_enabled AS enabled FROM public.profiles WHERE id = $1",
        [BRIDE_ID],
      );
      expect(before.rows[0]?.enabled).toBe(true);

      const result = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.set_amora_care_consent($1, false) AS result",
        [BRIDE_ID],
      );
      expect(result.rows[0]?.result).toMatchObject({
        profile: {
          id: BRIDE_ID,
          care_notifications_enabled: false,
          care_notifications_consented_at: null,
        },
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("quarantines and scrubs active jobs idempotently while outbound care is disabled", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await enqueue(db, "quarantine");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      await db.query(
        "SELECT public.prepare_amora_care_job($1, $2, true)",
        [claim.rows[0]?.result.id, claim.rows[0]?.result.lease_token],
      );

      const quarantined = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.quarantine_amora_care_queue('outbound_disabled') AS result",
      );
      expect(quarantined.rows[0]?.result).toEqual({ jobs: 1, deliveries: 2 });
      const job = await db.query<{
        status: string;
        content: string;
        email_subject: string | null;
        metadata: Record<string, unknown>;
      }>(
        "SELECT status, content, email_subject, metadata FROM public.amora_care_jobs WHERE id = $1",
        [claim.rows[0]?.result.id],
      );
      expect(job.rows[0]).toEqual({
        status: "cancelled",
        content: "[redacted]",
        email_subject: null,
        metadata: {},
      });
      const deliveries = await db.query<{ active: number; recipient_pii: number }>(`
        SELECT
          count(*) FILTER (WHERE status IN ('pending', 'processing'))::integer AS active,
          count(*) FILTER (WHERE recipient_email IS NOT NULL OR recipient_name IS NOT NULL)::integer AS recipient_pii
        FROM public.amora_care_deliveries
        WHERE job_id = $1
      `, [claim.rows[0]?.result.id]);
      expect(deliveries.rows[0]).toEqual({ active: 0, recipient_pii: 0 });

      const repeated = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.quarantine_amora_care_queue('outbound_disabled') AS result",
      );
      expect(repeated.rows[0]?.result).toEqual({ jobs: 0, deliveries: 0 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("persists chat once and retries email with one stable provider idempotency key", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await db.query("UPDATE public.profiles SET email = 'third-party@example.com' WHERE id = $1", [
        BRIDE_ID,
      ]);
      await enqueue(db, "16");
      const firstClaim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(30) AS result",
      );
      const jobId = firstClaim.rows[0]?.result.id;
      const firstToken = firstClaim.rows[0]?.result.lease_token;
      const prepared = await db.query<{ result: { state: string; chat_message_id: string } }>(
        "SELECT public.prepare_amora_care_job($1, $2, true) AS result",
        [jobId, firstToken],
      );
      expect(prepared.rows[0]?.result.state).toBe("ready");
      const durableMembers = await db.query<{ count: number; distinct_keys: number }>(`
        SELECT count(*)::integer AS count,
               count(DISTINCT idempotency_key)::integer AS distinct_keys
        FROM public.amora_care_deliveries
        WHERE job_id = $1
      `, [jobId]);
      expect(durableMembers.rows[0]).toEqual({ count: 2, distinct_keys: 2 });

      const queuedRecipients = await db.query<{ copied: number }>(`
        SELECT count(*) FILTER (
          WHERE recipient_email IS NOT NULL OR recipient_name IS NOT NULL
        )::integer AS copied
        FROM public.amora_care_deliveries
        WHERE job_id = $1
      `, [jobId]);
      expect(queuedRecipients.rows[0]?.copied).toBe(0);

      const delivery = await db.query<{
        result: { id: string; idempotency_key: string; user_id: string };
      }>("SELECT public.claim_amora_care_email_delivery($1, $2) AS result", [jobId, firstToken]);
      const stableKey = delivery.rows[0]?.result.idempotency_key;
      expect(stableKey).toContain(jobId.replaceAll("-", ""));

      // Simulate process death after the provider accepted the email but before
      // finish_amora_care_email_delivery was persisted.
      await db.exec("UPDATE public.amora_care_jobs SET lease_expires_at = now() - interval '1 second'");
      await db.query("UPDATE public.profiles SET name = 'Renamed' WHERE id = $1", [
        delivery.rows[0]?.result.user_id,
      ]);
      const retryClaim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      expect(retryClaim.rows[0]?.result.id).toBe(jobId);
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [
        jobId,
        retryClaim.rows[0]?.result.lease_token,
      ]);
      const retriedDelivery = await db.query<{
        result: { id: string; idempotency_key: string; user_id: string };
      }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [jobId, retryClaim.rows[0]?.result.lease_token],
      );
      expect(retriedDelivery.rows[0]?.result.user_id).toBe(delivery.rows[0]?.result.user_id);
      expect(retriedDelivery.rows[0]?.result.idempotency_key).toBe(stableKey);

      const retryPayload = await db.query<{
        content: string;
        email_subject: string;
        email_html: string;
        metadata: Record<string, unknown>;
        recipient_email: string;
        recipient_name: string | null;
      }>(`
        SELECT job.content, job.email_subject, job.email_html, job.metadata,
               delivery.recipient_email, delivery.recipient_name
        FROM public.amora_care_jobs AS job
        JOIN public.amora_care_deliveries AS delivery ON delivery.job_id = job.id
        WHERE delivery.id = $1
      `, [retriedDelivery.rows[0]?.result.id]);
      expect(retryPayload.rows[0]).toMatchObject({
        content: "오늘 확인할 일정이 있어요.",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        recipient_email: "bride-auth@example.com",
        recipient_name: null,
      });
      expect(retryPayload.rows[0]?.metadata).not.toEqual({});

      const retryToken = retryClaim.rows[0]?.result.lease_token;
      const firstFinished = await db.query<{ result: { state: string } }>(
        "SELECT public.finish_amora_care_email_delivery($1, $2, true, 'provider-1', NULL) AS result",
        [retriedDelivery.rows[0]?.result.id, retryToken],
      );
      expect(firstFinished.rows[0]?.result.state).toBe("completed");
      const secondDelivery = await db.query<{ result: { id: string; idempotency_key: string } }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [jobId, retryToken],
      );
      expect(secondDelivery.rows[0]?.result.idempotency_key).not.toBe(stableKey);
      await db.query(
        "SELECT public.finish_amora_care_email_delivery($1, $2, true, 'provider-2', NULL)",
        [secondDelivery.rows[0]?.result.id, retryToken],
      );
      const completed = await db.query<{ result: { state: string } }>(
        "SELECT public.finish_amora_care_job($1, $2) AS result",
        [jobId, retryToken],
      );
      expect(completed.rows[0]?.result.state).toBe("completed");

      const messages = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.chat_messages",
      );
      expect(messages.rows[0]?.count).toBe(1);
      const scrubbed = await db.query<{
        content: string;
        email_subject: string | null;
        email_html: string | null;
        metadata: Record<string, unknown>;
        retained_recipients: number;
      }>(`
        SELECT job.content, job.email_subject, job.email_html, job.metadata,
               count(*) FILTER (
                 WHERE delivery.recipient_email IS NOT NULL
                    OR delivery.recipient_name IS NOT NULL
               )::integer AS retained_recipients
        FROM public.amora_care_jobs AS job
        JOIN public.amora_care_deliveries AS delivery ON delivery.job_id = job.id
        WHERE job.id = $1
        GROUP BY job.id
      `, [jobId]);
      expect(scrubbed.rows[0]).toEqual({
        content: "[redacted]",
        email_subject: null,
        email_html: null,
        metadata: {},
        retained_recipients: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("scrubs queued recipients and payload when consent is withdrawn before email claim", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await enqueue(db, "withdraw");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      const jobId = claim.rows[0]?.result.id;
      const token = claim.rows[0]?.result.lease_token;
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [jobId, token]);
      await db.query(
        "UPDATE public.profiles SET care_notifications_enabled = false, care_notifications_consented_at = NULL WHERE id = $1",
        [GROOM_ID],
      );

      const delivery = await db.query<{ result: { state: string } }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [jobId, token],
      );
      expect(delivery.rows[0]?.result.state).toBe("cancelled");
      const terminal = await db.query<{
        status: string;
        content: string;
        metadata: Record<string, unknown>;
        retained_recipients: number;
      }>(`
        SELECT job.status, job.content, job.metadata,
               count(*) FILTER (
                 WHERE delivery.recipient_email IS NOT NULL
                    OR delivery.recipient_name IS NOT NULL
               )::integer AS retained_recipients
        FROM public.amora_care_jobs AS job
        JOIN public.amora_care_deliveries AS delivery ON delivery.job_id = job.id
        WHERE job.id = $1
        GROUP BY job.id
      `, [jobId]);
      expect(terminal.rows[0]).toEqual({
        status: "cancelled",
        content: "[redacted]",
        metadata: {},
        retained_recipients: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically withdraws consent and scrubs active jobs even when the cron is disabled", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await db.query("UPDATE public.couples SET groom_id = NULL WHERE id = $1", [COUPLE_ID]);
      await enqueue(db, "atomic-optout");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      const jobId = claim.rows[0]?.result.id;
      const token = claim.rows[0]?.result.lease_token;
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [jobId, token]);
      const delivery = await db.query<{ result: { state: string; email: string } }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [jobId, token],
      );
      expect(delivery.rows[0]?.result).toMatchObject({
        state: "ready",
        email: "bride-auth@example.com",
      });

      const withdrawn = await db.query<{
        result: { cancelled_jobs: number; profile: Record<string, unknown> };
      }>("SELECT public.set_amora_care_consent($1, false) AS result", [BRIDE_ID]);
      expect(withdrawn.rows[0]?.result.cancelled_jobs).toBe(1);
      expect(withdrawn.rows[0]?.result.profile).toMatchObject({
        care_notifications_enabled: false,
        care_notifications_consented_at: null,
      });

      const scrubbed = await db.query<{
        status: string;
        content: string;
        email_subject: string | null;
        email_html: string | null;
        metadata: Record<string, unknown>;
        retained_recipients: number;
      }>(`
        SELECT job.status, job.content, job.email_subject, job.email_html, job.metadata,
               count(*) FILTER (
                 WHERE delivery.recipient_email IS NOT NULL
                    OR delivery.recipient_name IS NOT NULL
               )::integer AS retained_recipients
        FROM public.amora_care_jobs AS job
        JOIN public.amora_care_deliveries AS delivery ON delivery.job_id = job.id
        WHERE job.id = $1
        GROUP BY job.id
      `, [jobId]);
      expect(scrubbed.rows[0]).toEqual({
        status: "cancelled",
        content: "[redacted]",
        email_subject: null,
        email_html: null,
        metadata: {},
        retained_recipients: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("cancels a one-member delivery when that member is replaced before re-prepare", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await db.query("UPDATE public.couples SET groom_id = NULL WHERE id = $1", [COUPLE_ID]);
      await enqueue(db, "roster-reprepare");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      const jobId = claim.rows[0]?.result.id;
      const token = claim.rows[0]?.result.lease_token;
      const firstPrepare = await db.query<{ result: { state: string } }>(
        "SELECT public.prepare_amora_care_job($1, $2, true) AS result",
        [jobId, token],
      );
      expect(firstPrepare.rows[0]?.result.state).toBe("ready");

      await db.exec("RESET ROLE");
      await db.exec(`
        INSERT INTO auth.users(id) VALUES ('${REPLACEMENT_ID}');
        INSERT INTO public.profiles(
          id, email, name, care_notifications_enabled, care_notifications_consented_at
        ) VALUES ('${REPLACEMENT_ID}', 'replacement@example.com', 'Replacement', true, now());
      `);
      await asService(db);
      await db.query("UPDATE public.couples SET bride_id = $1 WHERE id = $2", [
        REPLACEMENT_ID,
        COUPLE_ID,
      ]);

      const reprepare = await db.query<{ result: { state: string } }>(
        "SELECT public.prepare_amora_care_job($1, $2, true) AS result",
        [jobId, token],
      );
      expect(reprepare.rows[0]?.result.state).toBe("cancelled");
      const terminal = await db.query<{
        status: string;
        retained_recipients: number;
      }>(`
        SELECT job.status,
               count(*) FILTER (
                 WHERE delivery.recipient_email IS NOT NULL
                    OR delivery.recipient_name IS NOT NULL
               )::integer AS retained_recipients
        FROM public.amora_care_jobs AS job
        JOIN public.amora_care_deliveries AS delivery ON delivery.job_id = job.id
        WHERE job.id = $1
        GROUP BY job.id
      `, [jobId]);
      expect(terminal.rows[0]).toEqual({ status: "cancelled", retained_recipients: 0 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("never sends a pre-change job to a newly linked fully-consented roster", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await enqueue(db, "roster-before-prepare");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      const jobId = claim.rows[0]?.result.id;
      const token = claim.rows[0]?.result.lease_token;

      await db.exec("RESET ROLE");
      await db.exec(`
        INSERT INTO auth.users(id, email, email_confirmed_at)
        VALUES ('${REPLACEMENT_ID}', 'replacement-auth@example.com', now());
        INSERT INTO public.profiles(
          id, email, name, care_notifications_enabled, care_notifications_consented_at
        ) VALUES ('${REPLACEMENT_ID}', 'replacement@example.com', 'Replacement', true, now());
      `);
      await asService(db);
      await db.query("UPDATE public.couples SET groom_id = $1 WHERE id = $2", [
        REPLACEMENT_ID,
        COUPLE_ID,
      ]);

      const prepared = await db.query<{ result: { state: string } }>(
        "SELECT public.prepare_amora_care_job($1, $2, true) AS result",
        [jobId, token],
      );
      expect(prepared.rows[0]?.result.state).toBe("cancelled");
      const state = await db.query<{ messages: number; deliveries: number; status: string }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages) AS messages,
          (SELECT count(*)::integer FROM public.amora_care_deliveries WHERE job_id = $1) AS deliveries,
          (SELECT status FROM public.amora_care_jobs WHERE id = $1) AS status
      `, [jobId]);
      expect(state.rows[0]).toEqual({ messages: 0, deliveries: 0, status: "cancelled" });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("cancels a one-member delivery when that member is replaced before email claim", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await db.query("UPDATE public.couples SET groom_id = NULL WHERE id = $1", [COUPLE_ID]);
      await enqueue(db, "roster-delivery-claim");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      const jobId = claim.rows[0]?.result.id;
      const token = claim.rows[0]?.result.lease_token;
      await db.query("SELECT public.prepare_amora_care_job($1, $2, true)", [jobId, token]);

      await db.exec("RESET ROLE");
      await db.exec(`
        INSERT INTO auth.users(id) VALUES ('${REPLACEMENT_ID}');
        INSERT INTO public.profiles(
          id, email, name, care_notifications_enabled, care_notifications_consented_at
        ) VALUES ('${REPLACEMENT_ID}', 'replacement@example.com', 'Replacement', true, now());
      `);
      await asService(db);
      await db.query("UPDATE public.couples SET bride_id = $1 WHERE id = $2", [
        REPLACEMENT_ID,
        COUPLE_ID,
      ]);

      const delivery = await db.query<{ result: { state: string; email?: string } }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [jobId, token],
      );
      expect(delivery.rows[0]?.result.state).toBe("cancelled");
      expect(JSON.stringify(delivery.rows[0]?.result)).not.toContain("bride@example.com");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("records explicit skipped email states and completes chat when Resend is unavailable", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await enqueue(db, "16");
      const claim = await db.query<{ result: { id: string; lease_token: string } }>(
        "SELECT public.claim_amora_care_job(90) AS result",
      );
      const jobId = claim.rows[0]?.result.id;
      const token = claim.rows[0]?.result.lease_token;
      const prepared = await db.query<{ result: { state: string } }>(
        "SELECT public.prepare_amora_care_job($1, $2, false) AS result",
        [jobId, token],
      );
      expect(prepared.rows[0]?.result.state).toBe("ready");
      const deliveries = await db.query<{ status: string; last_error: string }>(`
        SELECT status, last_error
        FROM public.amora_care_deliveries
        WHERE job_id = $1 ORDER BY user_id
      `, [jobId]);
      expect(deliveries.rows).toEqual([
        { status: "skipped", last_error: "resend_disabled" },
        { status: "skipped", last_error: "resend_disabled" },
      ]);
      const finished = await db.query<{ result: { state: string } }>(
        "SELECT public.finish_amora_care_job($1, $2) AS result",
        [jobId, token],
      );
      expect(finished.rows[0]?.result.state).toBe("completed_with_warning");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("expires a stale KST scan-day job instead of delivering late copy", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const stale = await db.query<{ result: { id: string; status: string } }>(
        `SELECT public.enqueue_amora_care_job(
           $1, DATE '2020-01-01', 'stale:d1:2020-01-01', '늦으면 안 되는 문구', '{}'::jsonb
         ) AS result`,
        [COUPLE_ID],
      );
      expect(stale.rows[0]?.result.status).toBe("expired");
      const claim = await db.query<{ result: unknown }>("SELECT public.claim_amora_care_job(90) AS result");
      expect(claim.rows[0]?.result).toBeNull();
      const stalePayload = await db.query<{
        content: string;
        email_subject: string | null;
        email_html: string | null;
        metadata: Record<string, unknown>;
      }>(`
        SELECT content, email_subject, email_html, metadata
        FROM public.amora_care_jobs
        WHERE id = $1
      `, [stale.rows[0]?.result.id]);
      expect(stalePayload.rows[0]).toEqual({
        content: "[redacted]",
        email_subject: null,
        email_html: null,
        metadata: {},
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
