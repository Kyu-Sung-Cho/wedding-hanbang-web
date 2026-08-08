// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804185000_notification_delivery_outbox.sql",
  ),
  "utf8",
);

const RECIPIENT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSTALLATION = "10000000-0000-4000-8000-000000000001";
const POST = "40000000-0000-4000-8000-000000000001";
const TOKEN = "ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]";

const databases: PGlite[] = [];

function commentId(index: number) {
  return `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function notificationId(index: number) {
  return `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA community_private;

    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;
    CREATE FUNCTION public.community_request_is_service()
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    $$;
    CREATE FUNCTION public.community_runtime_mode()
    RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'normal'::text $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION public.community_request_is_service(),
      public.community_runtime_mode() TO PUBLIC;

    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE auth.sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
    );
    INSERT INTO auth.users(id) VALUES
      ('${RECIPIENT}'), ('${ACTOR}'), ('${OTHER}');
    INSERT INTO auth.sessions(id, user_id) VALUES ('${SESSION}', '${RECIPIENT}');

    CREATE TABLE public.community_viewer_controls (
      blocker_user_id uuid NOT NULL,
      blocked_user_id uuid NOT NULL,
      revoked_at timestamptz,
      PRIMARY KEY (blocker_user_id, blocked_user_id)
    );
    CREATE FUNCTION community_private.users_are_blocked(uuid, uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.community_viewer_controls AS control
        WHERE control.revoked_at IS NULL
          AND (
            (control.blocker_user_id = $1 AND control.blocked_user_id = $2)
            OR (control.blocker_user_id = $2 AND control.blocked_user_id = $1)
          )
      )
    $$;

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL REFERENCES auth.users(id),
      visibility text NOT NULL CHECK (visibility IN ('public', 'members', 'draft')),
      under_review boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id),
      is_deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id),
      is_suspended boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_reply_notifications (
      id uuid PRIMARY KEY,
      recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      comment_id uuid NOT NULL REFERENCES public.community_comments(id) ON DELETE CASCADE,
      parent_comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('post_reply', 'comment_reply')),
      read_at timestamptz,
      viewer_control_hidden_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (recipient_id, comment_id)
    );
    ALTER TABLE public.community_reply_notifications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notification_owner_select
      ON public.community_reply_notifications FOR SELECT TO authenticated
      USING (recipient_id = auth.uid());
    CREATE POLICY notification_owner_update
      ON public.community_reply_notifications FOR UPDATE TO authenticated
      USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
    GRANT SELECT, UPDATE (read_at, viewer_control_hidden_at)
      ON public.community_reply_notifications TO authenticated;

    CREATE FUNCTION public.community_guard_reply_notification_read()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, pg_temp AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER trg_community_reply_notifications_read_only
      BEFORE UPDATE ON public.community_reply_notifications
      FOR EACH ROW EXECUTE FUNCTION public.community_guard_reply_notification_read();

    CREATE TABLE public.mobile_push_device_tokens (
      installation_id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
      push_token text,
      platform text NOT NULL,
      binding_epoch bigint NOT NULL DEFAULT 1,
      bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      last_access_token_expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      revoke_reason text
    );

    INSERT INTO public.community_profiles(user_id) VALUES ('${RECIPIENT}'), ('${ACTOR}');
    INSERT INTO public.community_posts(id, author_id, visibility)
    VALUES ('${POST}', '${RECIPIENT}', 'members');
    INSERT INTO public.community_comments(id, post_id, author_id)
    SELECT
      ('50000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
      '${POST}',
      '${ACTOR}'
    FROM generate_series(1, 20) AS value;
    INSERT INTO public.mobile_push_device_tokens(
      installation_id, user_id, session_id, push_token, platform,
      binding_epoch, last_access_token_expires_at
    ) VALUES (
      '${INSTALLATION}', '${RECIPIENT}', '${SESSION}', '${TOKEN}', 'ios', 1,
      clock_timestamp() + interval '1 hour'
    );
  `);
  await db.exec(migration);
  return db;
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function setAuthenticated(db: PGlite, userId = RECIPIENT) {
  await resetPersona(db);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
  );
  await db.exec("SET ROLE authenticated;");
}

async function setService(db: PGlite) {
  await resetPersona(db);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  await db.exec("SET ROLE service_role;");
}

async function setPreference(db: PGlite, enabled: boolean) {
  await setAuthenticated(db);
  await db.query("SELECT public.community_set_reply_push_preference($1)", [enabled]);
  await resetPersona(db);
}

async function insertNotification(db: PGlite, index: number) {
  await resetPersona(db);
  await db.query(
    `INSERT INTO public.community_reply_notifications(
       id, recipient_id, actor_id, post_id, comment_id, kind
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'post_reply')`,
    [notificationId(index), RECIPIENT, ACTOR, POST, commentId(index)],
  );
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("notification delivery outbox migration", () => {
  it("is default-off, content-free, private, and transactionally coupled to notifications", async () => {
    const db = await createDatabase();
    await insertNotification(db, 1);
    const defaultOff = await db.query<{ state: string; terminal_reason: string }>(`
      SELECT state, terminal_reason FROM public.notification_delivery_outbox
      WHERE notification_id = '${notificationId(1)}'
    `);
    expect(defaultOff.rows).toEqual([{
      state: "cancelled",
      terminal_reason: "preference_disabled",
    }]);

    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notification_delivery_outbox'
    `);
    const names = columns.rows.map(({ column_name }) => column_name);
    expect(names).not.toEqual(expect.arrayContaining([
      "title", "body", "content", "vendor", "amount", "wedding_date", "push_token",
    ]));

    await setService(db);
    await expect(db.query(
      "SELECT * FROM public.notification_delivery_outbox",
    )).rejects.toThrow(/permission denied/iu);

    await setPreference(db, true);
    const consent = await db.query<{
      reply_push_enabled: boolean;
      consent_version: number;
      consented_at: Date | null;
      disabled_at: Date | null;
    }>(`
      SELECT reply_push_enabled, consent_version, consented_at, disabled_at
      FROM public.community_notification_push_preferences
      WHERE user_id = '${RECIPIENT}'
    `);
    expect(consent.rows[0]).toMatchObject({
      reply_push_enabled: true,
      consent_version: 1,
      disabled_at: null,
    });
    expect(consent.rows[0]?.consented_at).not.toBeNull();
    await db.exec("BEGIN;");
    await db.query(
      `INSERT INTO public.community_reply_notifications(
         id, recipient_id, actor_id, post_id, comment_id, kind
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'post_reply')`,
      [notificationId(2), RECIPIENT, ACTOR, POST, commentId(2)],
    );
    const inside = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM public.notification_delivery_outbox
      WHERE notification_id = '${notificationId(2)}'
    `);
    expect(inside.rows).toEqual([{ count: 1 }]);
    await db.exec("ROLLBACK;");
    const afterRollback = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM public.notification_delivery_outbox
      WHERE notification_id = '${notificationId(2)}'
    `);
    expect(afterRollback.rows).toEqual([{ count: 0 }]);
  });

  it("allows only monotonic read/hidden transitions and cancels after a lease", async () => {
    const db = await createDatabase();
    await setPreference(db, true);
    await insertNotification(db, 3);
    const lease = "70000000-0000-4000-8000-000000000003";
    await setService(db);
    const claimed = await db.query<{ delivery_id: string }>(
      "SELECT delivery_id FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [lease],
    );
    expect(claimed.rows).toHaveLength(1);

    await setAuthenticated(db);
    await db.query(
      "UPDATE public.community_reply_notifications SET viewer_control_hidden_at = now() WHERE id = $1::uuid",
      [notificationId(3)],
    );
    await setService(db);
    const confirmed = await db.query(
      "SELECT * FROM public.community_confirm_notification_push_batch($1::uuid, $2::uuid[])",
      [lease, claimed.rows.map(({ delivery_id }) => delivery_id)],
    );
    expect(confirmed.rows).toEqual([]);
    await resetPersona(db);
    const hidden = await db.query<{ state: string; terminal_reason: string }>(`
      SELECT state, terminal_reason FROM public.notification_delivery_outbox
      WHERE notification_id = '${notificationId(3)}'
    `);
    expect(hidden.rows).toEqual([{ state: "cancelled", terminal_reason: "viewer_hidden" }]);

    await insertNotification(db, 4);
    await setAuthenticated(db);
    await db.query(
      "UPDATE public.community_reply_notifications SET read_at = now() WHERE id = $1::uuid",
      [notificationId(4)],
    );
    await expect(db.query(
      "UPDATE public.community_reply_notifications SET read_at = now() WHERE id = $1::uuid",
      [notificationId(4)],
    )).rejects.toThrow(/COMMUNITY_REPLY_NOTIFICATION_READ_ONLY/u);

    await resetPersona(db);
    await insertNotification(db, 5);
    await setAuthenticated(db);
    await db.query(
      `UPDATE public.community_reply_notifications
       SET read_at = now(), viewer_control_hidden_at = now()
       WHERE id = $1::uuid`,
      [notificationId(5)],
    );
    await expect(db.query(
      "UPDATE public.community_reply_notifications SET viewer_control_hidden_at = NULL WHERE id = $1::uuid",
      [notificationId(5)],
    )).rejects.toThrow(/COMMUNITY_REPLY_NOTIFICATION_READ_ONLY/u);
  });

  it("rechecks block/content/preference and resolves taps only for the current owner", async () => {
    const db = await createDatabase();
    await setPreference(db, true);
    await insertNotification(db, 6);
    const lease = "70000000-0000-4000-8000-000000000006";
    await setService(db);
    const claimed = await db.query<{ delivery_id: string; notification_id: string }>(
      "SELECT * FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [lease],
    );
    const delivery = claimed.rows[0];
    expect(delivery).toBeDefined();
    const confirmed = await db.query(
      "SELECT * FROM public.community_confirm_notification_push_batch($1::uuid, $2::uuid[])",
      [lease, [delivery?.delivery_id]],
    );
    expect(confirmed.rows).toHaveLength(1);
    await db.query(
      "SELECT public.community_record_notification_push_ticket($1::uuid, $2::uuid, $3, NULL)",
      [delivery?.delivery_id, lease, "80000000-0000-4000-8000-000000000006"],
    );

    await setAuthenticated(db);
    const target = await db.query<{ result: Record<string, string> }>(
      "SELECT public.community_resolve_notification_push_target($1::uuid, $2::uuid) AS result",
      [delivery?.delivery_id, delivery?.notification_id],
    );
    expect(target.rows[0]?.result).toMatchObject({
      owner_id: RECIPIENT,
      delivery_id: delivery?.delivery_id,
      notification_id: notificationId(6),
      post_id: POST,
      comment_id: commentId(6),
    });

    await setAuthenticated(db, OTHER);
    const wrongOwner = await db.query<{ result: unknown }>(
      "SELECT public.community_resolve_notification_push_target($1::uuid, $2::uuid) AS result",
      [delivery?.delivery_id, delivery?.notification_id],
    );
    expect(wrongOwner.rows).toEqual([{ result: null }]);

    await resetPersona(db);
    await db.query(
      "INSERT INTO public.community_viewer_controls VALUES ($1::uuid, $2::uuid, NULL)",
      [RECIPIENT, ACTOR],
    );
    await setAuthenticated(db);
    const blocked = await db.query<{ result: unknown }>(
      "SELECT public.community_resolve_notification_push_target($1::uuid, $2::uuid) AS result",
      [delivery?.delivery_id, delivery?.notification_id],
    );
    expect(blocked.rows).toEqual([{ result: null }]);

    await resetPersona(db);
    await db.query("DELETE FROM public.community_viewer_controls");
    await db.query(
      "UPDATE public.community_comments SET is_deleted = true WHERE id = $1::uuid",
      [commentId(6)],
    );
    const unavailable = await db.query<{ terminal_reason: string }>(`
      SELECT terminal_reason FROM public.notification_delivery_outbox
      WHERE id = '${delivery?.delivery_id}'
    `);
    expect(unavailable.rows).toEqual([{ terminal_reason: "content_unavailable" }]);

    await setPreference(db, false);
    await setAuthenticated(db);
    const preference = await db.query<{ enabled: boolean }>(
      "SELECT public.community_get_reply_push_preference() AS enabled",
    );
    expect(preference.rows).toEqual([{ enabled: false }]);
  });

  it("records Expo receipts and never revokes a newer installation epoch", async () => {
    const db = await createDatabase();
    await setPreference(db, true);
    await insertNotification(db, 7);
    const sendLease = "70000000-0000-4000-8000-000000000007";
    await setService(db);
    const claimed = await db.query<{ delivery_id: string }>(
      "SELECT delivery_id FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [sendLease],
    );
    const deliveryId = claimed.rows[0]?.delivery_id;
    await db.query(
      "SELECT * FROM public.community_confirm_notification_push_batch($1::uuid, $2::uuid[])",
      [sendLease, [deliveryId]],
    );
    await db.query(
      "SELECT public.community_record_notification_push_ticket($1::uuid, $2::uuid, $3, NULL)",
      [deliveryId, sendLease, "80000000-0000-4000-8000-000000000007"],
    );

    await resetPersona(db);
    await db.query(`
      UPDATE public.mobile_push_device_tokens
      SET binding_epoch = 2,
          push_token = 'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]',
          last_seen_at = clock_timestamp()
      WHERE installation_id = '${INSTALLATION}'
    `);
    await db.query(`
      UPDATE public.notification_delivery_outbox
      SET next_receipt_at = clock_timestamp() - interval '1 minute'
      WHERE id = '${deliveryId}'
    `);

    const receiptLease = "90000000-0000-4000-8000-000000000007";
    await setService(db);
    const receipts = await db.query<{ delivery_id: string }>(
      "SELECT delivery_id FROM public.community_claim_notification_push_receipts($1::uuid, 50)",
      [receiptLease],
    );
    expect(receipts.rows).toEqual([{ delivery_id: deliveryId }]);
    await db.query(
      "SELECT public.community_record_notification_push_receipt($1::uuid, $2::uuid, 'error', 'DeviceNotRegistered')",
      [deliveryId, receiptLease],
    );
    await resetPersona(db);
    const newBinding = await db.query<{
      binding_epoch: number;
      push_token: string | null;
      revoked_at: Date | null;
    }>(`
      SELECT binding_epoch, push_token, revoked_at
      FROM public.mobile_push_device_tokens
      WHERE installation_id = '${INSTALLATION}'
    `);
    expect(newBinding.rows).toEqual([{
      binding_epoch: 2,
      push_token: "ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]",
      revoked_at: null,
    }]);

    // A later ticket for the current epoch revokes that exact token.
    await insertNotification(db, 9);
    const currentSendLease = "70000000-0000-4000-8000-000000000009";
    await setService(db);
    const currentClaim = await db.query<{ delivery_id: string }>(
      "SELECT delivery_id FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [currentSendLease],
    );
    const currentDeliveryId = currentClaim.rows[0]?.delivery_id;
    await db.query(
      "SELECT * FROM public.community_confirm_notification_push_batch($1::uuid, $2::uuid[])",
      [currentSendLease, [currentDeliveryId]],
    );
    await db.query(
      "SELECT public.community_record_notification_push_ticket($1::uuid, $2::uuid, $3, NULL)",
      [currentDeliveryId, currentSendLease, "80000000-0000-4000-8000-000000000009"],
    );
    await resetPersona(db);
    await db.query(`
      UPDATE public.notification_delivery_outbox
      SET next_receipt_at = clock_timestamp() - interval '1 minute'
      WHERE id = '${currentDeliveryId}'
    `);
    const currentReceiptLease = "90000000-0000-4000-8000-000000000009";
    await setService(db);
    await db.query(
      "SELECT * FROM public.community_claim_notification_push_receipts($1::uuid, 50)",
      [currentReceiptLease],
    );
    await db.query(
      "SELECT public.community_record_notification_push_receipt($1::uuid, $2::uuid, 'error', 'DeviceNotRegistered')",
      [currentDeliveryId, currentReceiptLease],
    );
    await resetPersona(db);
    const revoked = await db.query<{
      binding_epoch: number;
      push_token: string | null;
      revoke_reason: string | null;
    }>(`
      SELECT binding_epoch, push_token, revoke_reason
      FROM public.mobile_push_device_tokens
      WHERE installation_id = '${INSTALLATION}'
    `);
    expect(revoked.rows).toEqual([{
      binding_epoch: 2,
      push_token: null,
      revoke_reason: "provider_device_not_registered",
    }]);
    const terminal = await db.query<{ state: string; terminal_reason: string }>(`
      SELECT state, terminal_reason
      FROM public.notification_delivery_outbox
      WHERE id = '${currentDeliveryId}'
    `);
    expect(terminal.rows).toEqual([{
      state: "cancelled",
      terminal_reason: "token_revoked",
    }]);
  });

  it("terminally cancels a delivery when its exact Auth session disappears", async () => {
    const db = await createDatabase();
    await setPreference(db, true);
    await insertNotification(db, 8);
    await resetPersona(db);
    await db.query("DELETE FROM auth.sessions WHERE id = $1::uuid", [SESSION]);

    const state = await db.query<{ state: string; terminal_reason: string }>(`
      SELECT state, terminal_reason
      FROM public.notification_delivery_outbox
      WHERE notification_id = '${notificationId(8)}'
    `);
    expect(state.rows).toEqual([{
      state: "cancelled",
      terminal_reason: "target_inactive",
    }]);
    const binding = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM public.mobile_push_device_tokens
      WHERE installation_id = '${INSTALLATION}'
    `);
    expect(binding.rows).toEqual([{ count: 0 }]);
  });

  it("leases idempotently and applies bounded retry backoff", async () => {
    const db = await createDatabase();
    await setPreference(db, true);
    await insertNotification(db, 10);
    const firstLease = "70000000-0000-4000-8000-000000000010";
    await setService(db);
    const firstClaim = await db.query<{ delivery_id: string }>(
      "SELECT delivery_id FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [firstLease],
    );
    expect(firstClaim.rows).toHaveLength(1);
    const deliveryId = firstClaim.rows[0]?.delivery_id;
    const duplicateClaim = await db.query(
      "SELECT * FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [firstLease],
    );
    expect(duplicateClaim.rows).toEqual([]);
    await db.query(
      "SELECT public.community_record_notification_push_ticket($1::uuid, $2::uuid, NULL, 'network_error')",
      [deliveryId, firstLease],
    );
    await resetPersona(db);
    const retry = await db.query<{
      state: string;
      attempt_count: number;
      delayed: boolean;
    }>(`
      SELECT state, attempt_count,
        available_at > clock_timestamp() AS delayed
      FROM public.notification_delivery_outbox
      WHERE id = '${deliveryId}'
    `);
    expect(retry.rows).toEqual([{
      state: "retry_wait",
      attempt_count: 1,
      delayed: true,
    }]);

    const secondLease = "70000000-0000-4000-8000-000000000011";
    await setService(db);
    const beforeBackoff = await db.query(
      "SELECT * FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [secondLease],
    );
    expect(beforeBackoff.rows).toEqual([]);
    await resetPersona(db);
    await db.query(`
      UPDATE public.notification_delivery_outbox
      SET available_at = clock_timestamp() - interval '1 second'
      WHERE id = '${deliveryId}'
    `);
    await setService(db);
    const secondClaim = await db.query<{ delivery_id: string }>(
      "SELECT delivery_id FROM public.community_claim_notification_push_batch($1::uuid, 50)",
      [secondLease],
    );
    expect(secondClaim.rows).toEqual([{ delivery_id: deliveryId }]);
    await resetPersona(db);
    const attempt = await db.query<{ attempt_count: number }>(`
      SELECT attempt_count FROM public.notification_delivery_outbox
      WHERE id = '${deliveryId}'
    `);
    expect(attempt.rows).toEqual([{ attempt_count: 2 }]);
  });
});
