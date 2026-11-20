// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// P1(동의 화면)의 통과 기준을 저장소의 실제 마이그레이션 위에서 잰다.
//   1. 새 커플이 둘 다 켜면 다음 날 해당되는 케어 글이 함께 대화에 온다.
//   2. 한 사람이 끄면 그날 기다리던 글이 취소된다.
// 그리고 2026-11-13 파운더 결정(메일 동의는 따로)이 DB 에서 지켜지는지 본다.

function migration(name: string): string {
  return readFileSync(
    resolve(process.cwd(), "../../supabase/migrations", name),
    "utf8",
  );
}

const careQueue = migration("20260716093000_amora_care_queue.sql");
const deliveryPolicy = migration("20260716095000_amora_care_delivery_policy.sql");
const profilePatch = migration("20260716104000_profile_patch_atomic.sql");
const emailConsent = migration("20261120100000_amora_care_email_consent.sql");

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const SCAN_DAY = "2099-07-16";

type Seed = { legacyConsent?: boolean };

async function createDatabase(seed: Seed = {}) {
  const db = await PGlite.create();
  const legacy = seed.legacyConsent === true;
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
      phone text,
      phone_care_consented_at timestamptz,
      care_notifications_enabled boolean NOT NULL DEFAULT false,
      care_notifications_consented_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
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

    INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
      ('${BRIDE_ID}', 'bride-auth@example.com', now()),
      ('${GROOM_ID}', 'groom-auth@example.com', now());
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(
      id, email, name, care_notifications_enabled, care_notifications_consented_at
    ) VALUES
      ('${BRIDE_ID}', 'bride@example.com', 'Bride', ${legacy}, ${legacy ? "now()" : "NULL"}),
      ('${GROOM_ID}', 'groom@example.com', 'Groom', false, NULL);
    INSERT INTO public.wedding_journeys(couple_id) VALUES ('${COUPLE_ID}');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT ON public.couples TO authenticated;
    GRANT SELECT, UPDATE ON public.profiles TO authenticated;
  `);
  await db.exec(careQueue);
  await db.exec(deliveryPolicy);
  await db.exec(profilePatch);
  await db.exec(emailConsent);
  return db;
}

async function asService(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE service_role");
}

async function setDeliveryClock(db: PGlite, value: string) {
  await db.exec("RESET ROLE");
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.amora_care_delivery_clock()
    RETURNS timestamptz
    LANGUAGE sql
    STABLE
    AS $$ SELECT TIMESTAMPTZ '${value}' $$;
  `);
}

type PatchArgs = {
  userId: string;
  shared?: boolean;
  email?: boolean;
  promptAnswered?: boolean;
};

// The API calls this RPC with named arguments only, exactly like this.
async function patchCare(db: PGlite, args: PatchArgs) {
  await asService(db);
  const result = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.patch_profile_atomic(
       p_user_id => $1::uuid,
       p_care_notifications_enabled => $2::boolean,
       p_care_email_enabled => $3::boolean,
       p_care_prompt_answered => $4::boolean
     ) AS result`,
    [
      args.userId,
      args.shared ?? null,
      args.email ?? null,
      args.promptAnswered ?? false,
    ],
  );
  return result.rows[0]?.result;
}

async function consentRow(db: PGlite, userId: string) {
  await asService(db);
  const row = await db.query<{
    shared: boolean;
    shared_at: string | null;
    email: boolean;
    email_at: string | null;
    prompt_at: string | null;
  }>(
    `SELECT care_notifications_enabled AS shared,
            care_notifications_consented_at::text AS shared_at,
            care_email_enabled AS email,
            care_email_consented_at::text AS email_at,
            care_prompt_answered_at::text AS prompt_at
     FROM public.profiles WHERE id = $1`,
    [userId],
  );
  return row.rows[0]!;
}

// The cron scan at 00:10 KST enqueues the day's cell.
async function scanTomorrowsCell(db: PGlite, dedupeKey = "dress_fitting:d1:2099-07-17:event-1") {
  await setDeliveryClock(db, `${SCAN_DAY} 00:10:00+09`);
  await asService(db);
  const enqueued = await db.query<{ result: { id: string; status: string } }>(
    `SELECT public.enqueue_amora_care_job(
       $1, DATE '${SCAN_DAY}', $2, '내일은 드레스 피팅이에요. 신발을 챙겨 가요.',
       jsonb_build_object('moment', jsonb_build_object(
         'momentType', 'dress_fitting', 'cellKind', 'd1'
       )),
       '내일은 드레스 피팅이에요', '<p>내일은 드레스 피팅이에요.</p>'
     ) AS result`,
    [COUPLE_ID, dedupeKey],
  );
  return String(enqueued.rows[0]?.result.id);
}

// claim_amora_care_job compares available_at with the real clock, so a test
// stands in for "the morning has come" by making the deferred job available.
async function morningArrives(db: PGlite, jobId: string) {
  await setDeliveryClock(db, `${SCAN_DAY} 09:30:00+09`);
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE public.amora_care_jobs SET available_at = now() WHERE id = $1",
    [jobId],
  );
  await asService(db);
}

async function claimAndPrepare(db: PGlite, jobId: string) {
  const claim = await db.query<{ result: { lease_token: string } | null }>(
    "SELECT public.claim_amora_care_job(90, $1) AS result",
    [jobId],
  );
  const lease = claim.rows[0]?.result?.lease_token ?? null;
  if (!lease) return { lease: null, prepared: null };
  const prepared = await db.query<{ result: Record<string, unknown> }>(
    "SELECT public.prepare_amora_care_job($1, $2, true) AS result",
    [jobId, lease],
  );
  return { lease, prepared: prepared.rows[0]?.result ?? null };
}

async function sharedCareMessages(db: PGlite) {
  await asService(db);
  const rows = await db.query<{ content: string; visibility: string }>(
    `SELECT content, visibility FROM public.chat_messages
     WHERE couple_id = $1 AND sender_type = 'ai'`,
    [COUPLE_ID],
  );
  return rows.rows;
}

async function deliveries(db: PGlite, jobId: string) {
  await asService(db);
  const rows = await db.query<{
    user_id: string;
    status: string;
    last_error: string | null;
    recipient_email: string | null;
  }>(
    `SELECT user_id::text, status, last_error, recipient_email
     FROM public.amora_care_deliveries WHERE job_id = $1 ORDER BY user_id`,
    [jobId],
  );
  return rows.rows;
}

describe("P1 care consent screen: database contract", () => {
  it("delivers the next day's care message to a new couple once both turn it on", async () => {
    const db = await createDatabase();
    try {
      await patchCare(db, { userId: BRIDE_ID, shared: true, promptAnswered: true });
      await patchCare(db, { userId: GROOM_ID, shared: true });

      const jobId = await scanTomorrowsCell(db);
      expect(await sharedCareMessages(db)).toEqual([]);

      await morningArrives(db, jobId);
      const { prepared } = await claimAndPrepare(db, jobId);

      expect(prepared?.state).toBe("ready");
      expect(await sharedCareMessages(db)).toEqual([
        { content: "내일은 드레스 피팅이에요. 신발을 챙겨 가요.", visibility: "shared" },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("sends nothing while only one of the two has turned it on", async () => {
    const db = await createDatabase();
    try {
      await patchCare(db, { userId: BRIDE_ID, shared: true });

      const jobId = await scanTomorrowsCell(db);
      await morningArrives(db, jobId);
      const { prepared } = await claimAndPrepare(db, jobId);

      expect(prepared?.state).toBe("cancelled");
      expect(await sharedCareMessages(db)).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("cancels the day's waiting message when one person turns it off before it goes", async () => {
    const db = await createDatabase();
    try {
      await patchCare(db, { userId: BRIDE_ID, shared: true });
      await patchCare(db, { userId: GROOM_ID, shared: true });
      const jobId = await scanTomorrowsCell(db);

      await setDeliveryClock(db, `${SCAN_DAY} 08:00:00+09`);
      const withdrawal = await patchCare(db, { userId: GROOM_ID, shared: false });
      expect(withdrawal?.cancelled_jobs).toBe(1);

      await asService(db);
      const job = await db.query<{ status: string; last_error: string; content: string }>(
        "SELECT status, last_error, content FROM public.amora_care_jobs WHERE id = $1",
        [jobId],
      );
      expect(job.rows[0]).toEqual({
        status: "cancelled",
        last_error: "consent_withdrawn",
        content: "[redacted]",
      });

      await morningArrives(db, jobId);
      const { lease } = await claimAndPrepare(db, jobId);
      expect(lease).toBeNull();
      expect(await sharedCareMessages(db)).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("emails only the person who opted into email, never the one who only turned on the chat message", async () => {
    const db = await createDatabase();
    try {
      await patchCare(db, { userId: BRIDE_ID, shared: true, email: true });
      await patchCare(db, { userId: GROOM_ID, shared: true });
      const jobId = await scanTomorrowsCell(db);
      await morningArrives(db, jobId);
      const { lease, prepared } = await claimAndPrepare(db, jobId);
      expect(prepared?.state).toBe("ready");

      const first = await db.query<{ result: Record<string, unknown> | null }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [jobId, lease],
      );
      expect(first.rows[0]?.result).toMatchObject({
        state: "ready",
        user_id: BRIDE_ID,
        email: "bride-auth@example.com",
      });

      const rows = await deliveries(db, jobId);
      expect(rows).toEqual([
        { user_id: BRIDE_ID, status: "processing", last_error: null, recipient_email: "bride-auth@example.com" },
        { user_id: GROOM_ID, status: "skipped", last_error: "email_not_consented", recipient_email: null },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("turning email off cancels only that person's waiting email and keeps the chat message", async () => {
    const db = await createDatabase();
    try {
      await patchCare(db, { userId: BRIDE_ID, shared: true, email: true });
      await patchCare(db, { userId: GROOM_ID, shared: true, email: true });
      const jobId = await scanTomorrowsCell(db);
      await morningArrives(db, jobId);
      const { lease, prepared } = await claimAndPrepare(db, jobId);
      expect(prepared?.state).toBe("ready");

      const withdrawal = await patchCare(db, { userId: BRIDE_ID, email: false });
      expect(withdrawal?.cancelled_email_deliveries).toBe(1);
      expect(withdrawal?.cancelled_jobs).toBe(0);

      const next = await db.query<{ result: Record<string, unknown> | null }>(
        "SELECT public.claim_amora_care_email_delivery($1, $2) AS result",
        [jobId, lease],
      );
      expect(next.rows[0]?.result).toMatchObject({ state: "ready", user_id: GROOM_ID });
      expect((await deliveries(db, jobId))[0]).toMatchObject({
        user_id: BRIDE_ID,
        status: "cancelled",
        last_error: "email_consent_withdrawn",
        recipient_email: null,
      });
      expect(await sharedCareMessages(db)).toHaveLength(1);
      expect(await consentRow(db, BRIDE_ID)).toMatchObject({ shared: true, email: false, email_at: null });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("requires the chat message consent for email and withdraws email with it", async () => {
    const db = await createDatabase();
    try {
      await expect(patchCare(db, { userId: BRIDE_ID, email: true }))
        .rejects.toThrow(/PROFILE_PATCH_CARE_EMAIL_REQUIRES_SHARED_CONSENT/);
      await expect(patchCare(db, { userId: BRIDE_ID, shared: false, email: true }))
        .rejects.toThrow(/PROFILE_PATCH_CARE_EMAIL_REQUIRES_SHARED_CONSENT/);

      await patchCare(db, { userId: BRIDE_ID, shared: true, email: true });
      expect(await consentRow(db, BRIDE_ID)).toMatchObject({ shared: true, email: true });

      // The legacy opt-out path sends only the shared-chat flag.
      await patchCare(db, { userId: BRIDE_ID, shared: false });
      expect(await consentRow(db, BRIDE_ID)).toMatchObject({
        shared: false,
        shared_at: null,
        email: false,
        email_at: null,
      });

      // Turning the chat message back on never resumes email by itself.
      await patchCare(db, { userId: BRIDE_ID, shared: true });
      expect(await consentRow(db, BRIDE_ID)).toMatchObject({ shared: true, email: false });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("records the lounge question as answered once and keeps the first answer time", async () => {
    const db = await createDatabase();
    try {
      await patchCare(db, { userId: BRIDE_ID, promptAnswered: true });
      const first = (await consentRow(db, BRIDE_ID)).prompt_at;
      expect(first).not.toBeNull();
      expect(await consentRow(db, BRIDE_ID)).toMatchObject({ shared: false, email: false });

      await patchCare(db, { userId: BRIDE_ID, promptAnswered: true });
      expect((await consentRow(db, BRIDE_ID)).prompt_at).toBe(first);

      await expect(patchCare(db, { userId: BRIDE_ID }))
        .rejects.toThrow(/PROFILE_PATCH_INVALID/);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("refuses direct client writes to every consent column", async () => {
    const db = await createDatabase();
    try {
      for (const assignment of [
        "care_notifications_enabled = true, care_notifications_consented_at = now()",
        "care_email_enabled = true, care_email_consented_at = now()",
        "care_prompt_answered_at = now()",
      ]) {
        await db.exec("RESET ROLE");
        await db.exec("SET ROLE authenticated");
        await expect(
          db.query(`UPDATE public.profiles SET ${assignment} WHERE id = '${BRIDE_ID}'`),
        ).rejects.toThrow(/AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN/);
      }
      expect(await consentRow(db, BRIDE_ID)).toMatchObject({
        shared: false,
        email: false,
        prompt_at: null,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps an existing consent's email channel and exposes only the wrapped service functions", async () => {
    const db = await createDatabase({ legacyConsent: true });
    try {
      const bride = await consentRow(db, BRIDE_ID);
      expect(bride.shared).toBe(true);
      expect(bride.email).toBe(true);
      expect(bride.email_at).toBe(bride.shared_at);
      expect(await consentRow(db, GROOM_ID)).toMatchObject({ shared: false, email: false });

      await db.exec("RESET ROLE");
      const privileges = await db.query<{
        old_signature: string | null;
        service_patch: boolean;
        client_patch: boolean;
        service_inner_patch: boolean;
        service_claim: boolean;
        client_claim: boolean;
        service_inner_claim: boolean;
      }>(`
        SELECT
          to_regprocedure('public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)')::text
            AS old_signature,
          has_function_privilege('service_role',
            'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean,boolean,boolean)',
            'EXECUTE') AS service_patch,
          has_function_privilege('authenticated',
            'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean,boolean,boolean)',
            'EXECUTE') AS client_patch,
          has_function_privilege('service_role',
            'public.patch_profile_atomic_pre_email_consent(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)',
            'EXECUTE') AS service_inner_patch,
          has_function_privilege('service_role',
            'public.claim_amora_care_email_delivery(uuid,uuid)', 'EXECUTE') AS service_claim,
          has_function_privilege('authenticated',
            'public.claim_amora_care_email_delivery(uuid,uuid)', 'EXECUTE') AS client_claim,
          has_function_privilege('service_role',
            'public.claim_amora_care_email_delivery_pre_email_consent(uuid,uuid)', 'EXECUTE')
            AS service_inner_claim
      `);
      expect(privileges.rows[0]).toEqual({
        old_signature: null,
        service_patch: true,
        client_patch: false,
        service_inner_patch: false,
        service_claim: true,
        client_claim: false,
        service_inner_claim: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
