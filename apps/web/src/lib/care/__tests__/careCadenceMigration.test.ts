// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// P2(먼저 말 걸기 켜기·강도·시간)의 통과 기준을 저장소의 실제 마이그레이션 위에서 잰다.
//   1. 일정이 자정 뒤에 취소되면 그날 09:00의 글이 가지 않는다.
//   2. 강도 "덜"에서 마감 임박이 아닌 글이 0건.
//   3. 하루 상한을 넘는 글이 0건.

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), "../../supabase/migrations", name), "utf8");
}

const MIGRATIONS = [
  "20260716091000_care_explicit_consent.sql",
  "20260716093000_amora_care_queue.sql",
  "20260716095000_amora_care_delivery_policy.sql",
  "20260716104000_profile_patch_atomic.sql",
  "20260802090000_amora_moment_care_source_revision.sql",
  "20261120100000_amora_care_email_consent.sql",
  "20261120110000_amora_care_cadence.sql",
].map(migration);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const SCAN_DAY = "2099-07-16";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '${BRIDE_ID}'::uuid $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
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
      user_id uuid PRIMARY KEY, nickname text NOT NULL, badge text NOT NULL DEFAULT 'member',
      post_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL,
      visibility text NOT NULL DEFAULT 'public', under_review boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL,
      is_deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id),
      wedding_date date,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      state_revision bigint NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid, sender_type text NOT NULL, role text NOT NULL, content text NOT NULL,
      sender_role text, specialist_type text, stage_tag text,
      visibility text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
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
    INSERT INTO public.profiles(id, email, name) VALUES
      ('${BRIDE_ID}', 'bride@example.com', 'Bride'),
      ('${GROOM_ID}', 'groom@example.com', 'Groom');
    INSERT INTO public.wedding_journeys(couple_id) VALUES ('${COUPLE_ID}');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT ON public.couples TO authenticated;
    GRANT SELECT, UPDATE ON public.profiles TO authenticated;
  `);
  for (const sql of MIGRATIONS) await db.exec(sql);
  // Both people opted in through the service RPC, as the settings screen does.
  await asService(db);
  for (const id of [BRIDE_ID, GROOM_ID]) {
    await db.query(
      "SELECT public.patch_profile_atomic(p_user_id => $1::uuid, p_care_notifications_enabled => true)",
      [id],
    );
  }
  return db;
}

async function asService(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE service_role");
}

async function setClock(db: PGlite, kstTime: string) {
  await db.exec("RESET ROLE");
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.amora_care_delivery_clock()
    RETURNS timestamptz LANGUAGE sql STABLE
    AS $$ SELECT TIMESTAMPTZ '${SCAN_DAY} ${kstTime}+09' $$;
  `);
  await asService(db);
}

async function setCadence(
  db: PGlite,
  userId: string,
  cadence: { intensity?: string; start?: number; end?: number },
) {
  await asService(db);
  return db.query<{ result: Record<string, unknown> }>(
    `SELECT public.set_amora_care_cadence(
       p_user_id => $1::uuid, p_intensity => $2::text,
       p_window_start_hour => $3::integer, p_window_end_hour => $4::integer
     ) AS result`,
    [userId, cadence.intensity ?? null, cadence.start ?? null, cadence.end ?? null],
  );
}

type Cell = { key: string; cellKind: "d3" | "d1" | "dAfter" };

async function enqueueCells(db: PGlite, cells: Cell[]) {
  await setClock(db, "00:10:00");
  const ids: string[] = [];
  for (const cell of cells) {
    const result = await db.query<{ result: { id: string } }>(
      `SELECT public.enqueue_amora_care_job(
         $1, DATE '${SCAN_DAY}', $2, $3,
         jsonb_build_object('moment', jsonb_build_object('momentType', 'dress_fitting', 'cellKind', $4::text))
       ) AS result`,
      [COUPLE_ID, cell.key, `케어 글 ${cell.key}`, cell.cellKind],
    );
    ids.push(String(result.rows[0]?.result.id));
  }
  return ids;
}

async function makeAvailable(db: PGlite, jobIds: string[]) {
  await db.exec("RESET ROLE");
  for (const id of jobIds) {
    await db.query("UPDATE public.amora_care_jobs SET available_at = now() WHERE id = $1", [id]);
  }
  await asService(db);
}

async function claim(db: PGlite, jobId: string) {
  const result = await db.query<{ result: { lease_token: string } | null }>(
    "SELECT public.claim_amora_care_job(90, $1) AS result",
    [jobId],
  );
  return result.rows[0]?.result?.lease_token ?? null;
}

async function prepare(
  db: PGlite,
  jobId: string,
  options: { revision?: number; content?: string } = {},
) {
  const lease = await claim(db, jobId);
  if (!lease) return { lease: null, result: null };
  const result = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.prepare_amora_care_job(
       p_job_id => $1, p_lease_token => $2, p_email_enabled => false,
       p_expected_journey_revision => $3::bigint, p_content => $4::text
     ) AS result`,
    [jobId, lease, options.revision ?? null, options.content ?? null],
  );
  return { lease, result: result.rows[0]?.result ?? null };
}

async function careMessages(db: PGlite) {
  await asService(db);
  const rows = await db.query<{ content: string; key: string }>(
    `SELECT content, metadata->>'client_request_id' AS key FROM public.chat_messages
     WHERE couple_id = $1 AND sender_type = 'ai' ORDER BY created_at, id`,
    [COUPLE_ID],
  );
  return rows.rows;
}

async function job(db: PGlite, id: string) {
  await asService(db);
  const rows = await db.query<{ status: string; last_error: string | null; content: string; available_at: string }>(
    "SELECT status, last_error, content, available_at::text FROM public.amora_care_jobs WHERE id = $1",
    [id],
  );
  return rows.rows[0]!;
}

describe("P2 care cadence: database contract", () => {
  it("never posts a message computed from a plan that changed after midnight", async () => {
    const db = await createDatabase();
    try {
      const [jobId] = await enqueueCells(db, [{ key: "dress_fitting:d1:2099-07-17:event-1", cellKind: "d1" }]);

      // 03:00, the couple cancels the fitting. The schedule edit bumps the revision.
      await db.exec("RESET ROLE");
      await db.query("UPDATE public.wedding_journeys SET state_revision = 1 WHERE couple_id = $1", [COUPLE_ID]);

      await setClock(db, "09:30:00");
      await makeAvailable(db, [jobId!]);
      // A worker still holding the midnight reading (revision 0) is refused.
      const stale = await prepare(db, jobId!, { revision: 0, content: "내일은 드레스 피팅이에요." });
      expect(stale.result).toEqual({ state: "deferred", reason: "source_stale" });
      expect(await careMessages(db)).toEqual([]);
      expect(await job(db, jobId!)).toMatchObject({ status: "pending", last_error: "source_stale" });

      // Recomputed on the current plan, the cell is gone: the job closes empty.
      await makeAvailable(db, [jobId!]);
      const lease = await claim(db, jobId!);
      const closed = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.cancel_amora_care_job_source_changed($1, $2) AS result",
        [jobId, lease],
      );
      expect(closed.rows[0]?.result).toEqual({ state: "cancelled", reason: "source_changed" });
      expect(await job(db, jobId!)).toMatchObject({
        status: "cancelled",
        last_error: "source_changed",
        content: "[redacted]",
      });
      expect(await careMessages(db)).toEqual([]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("posts the message recomputed on the current plan when the revision still matches", async () => {
    const db = await createDatabase();
    try {
      const [jobId] = await enqueueCells(db, [{ key: "dress_fitting:d1:2099-07-17:event-1", cellKind: "d1" }]);
      await db.exec("RESET ROLE");
      await db.query("UPDATE public.wedding_journeys SET state_revision = 4 WHERE couple_id = $1", [COUPLE_ID]);
      await setClock(db, "09:30:00");
      await makeAvailable(db, [jobId!]);
      const fresh = await prepare(db, jobId!, { revision: 4, content: "내일 오후 3시 드레스 피팅이에요." });
      expect(fresh.result?.state).toBe("ready");
      expect((await careMessages(db)).map((row) => row.content)).toEqual(["내일 오후 3시 드레스 피팅이에요."]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("posts nothing but day-before checks at intensity light", async () => {
    const db = await createDatabase();
    try {
      await setCadence(db, BRIDE_ID, { intensity: "light" });
      const ids = await enqueueCells(db, [
        { key: "studio:d3:2099-07-19:event-2", cellKind: "d3" },
        { key: "studio:dAfter:2099-07-15:event-3", cellKind: "dAfter" },
        { key: "dress_fitting:d1:2099-07-17:event-1", cellKind: "d1" },
      ]);
      await setClock(db, "10:00:00");
      await makeAvailable(db, ids);

      // A screen-open guardrail that is only a warning is also held back.
      const warning = await db.query<{ id: string | null }>(
        `SELECT public.insert_amora_care_message($1, '예산을 정할 때예요.',
           '{"client_request_id":"lifecycle:warning","lifecycle":{"severity":"warning"}}'::jsonb) AS id`,
        [COUPLE_ID],
      );
      expect(warning.rows[0]?.id).toBeNull();

      const results = [];
      for (const id of ids) results.push((await prepare(db, id)).result);
      expect(results).toEqual([
        { state: "cancelled", reason: "intensity_filtered" },
        { state: "cancelled", reason: "intensity_filtered" },
        expect.objectContaining({ state: "ready" }),
      ]);
      const posted = await careMessages(db);
      expect(posted).toHaveLength(1);
      expect(posted.every((row) => row.key.includes(":d1:"))).toBe(true);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("never exceeds one shared care message a day at intensity normal, across every path", async () => {
    const db = await createDatabase();
    try {
      const ids = await enqueueCells(db, [
        { key: "dress_fitting:d1:2099-07-17:event-1", cellKind: "d1" },
        { key: "studio:d3:2099-07-19:event-2", cellKind: "d3" },
      ]);
      await setClock(db, "10:00:00");
      await makeAvailable(db, ids);
      expect((await prepare(db, ids[0]!)).result?.state).toBe("ready");
      expect((await prepare(db, ids[1]!)).result).toEqual({
        state: "cancelled",
        reason: "daily_care_limit",
      });

      // The screen-open moment path counts against the same day.
      const moment = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.insert_amora_moment_care_message($1, 0, '사흘 뒤 촬영이에요.',
           '{"client_request_id":"moment:studio:d3:2099-07-19:event-9","moment":{"cellKind":"d3"}}'::jsonb) AS result`,
        [COUPLE_ID],
      );
      expect(moment.rows[0]?.result).toEqual({ state: "consent_required" });
      expect(await careMessages(db)).toHaveLength(1);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("allows three a day only when both choose more", async () => {
    const db = await createDatabase();
    try {
      await setCadence(db, BRIDE_ID, { intensity: "more" });
      await setCadence(db, GROOM_ID, { intensity: "more" });
      const ids = await enqueueCells(db, [
        { key: "a:d1:2099-07-17:e1", cellKind: "d1" },
        { key: "b:d3:2099-07-19:e2", cellKind: "d3" },
        { key: "c:dAfter:2099-07-15:e3", cellKind: "dAfter" },
        { key: "d:d3:2099-07-19:e4", cellKind: "d3" },
      ]);
      await setClock(db, "10:00:00");
      await makeAvailable(db, ids);
      const states = [];
      for (const id of ids) states.push((await prepare(db, id)).result?.state);
      expect(states).toEqual(["ready", "ready", "ready", "cancelled"]);
      expect(await careMessages(db)).toHaveLength(3);

      // If one of the two turns it down to normal, the couple gets one a day.
      await setCadence(db, GROOM_ID, { intensity: "normal" });
      const cadence = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.amora_care_couple_cadence($1) AS result",
        [COUPLE_ID],
      );
      expect(cadence.rows[0]?.result).toMatchObject({ intensity: "normal", daily_limit: 1 });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("delivers only inside the hours both people chose", async () => {
    const db = await createDatabase();
    try {
      await setCadence(db, BRIDE_ID, { start: 9, end: 12 });
      await setCadence(db, GROOM_ID, { start: 10, end: 20 });
      const [early] = await enqueueCells(db, [{ key: "a:d1:2099-07-17:e1", cellKind: "d1" }]);
      await setClock(db, "09:30:00");
      await makeAvailable(db, [early!]);
      const deferred = (await prepare(db, early!)).result;
      expect(deferred).toMatchObject({ state: "deferred", reason: "outside_delivery_window" });
      expect(new Date(String(deferred?.available_at)).toISOString()).toBe("2099-07-16T01:00:00.000Z");
      expect(await careMessages(db)).toEqual([]);

      await setClock(db, "12:30:00");
      await makeAvailable(db, [early!]);
      expect((await prepare(db, early!)).result).toEqual({
        state: "cancelled",
        reason: "outside_care_window",
      });

      await setCadence(db, BRIDE_ID, { start: 9, end: 10 });
      await setCadence(db, GROOM_ID, { start: 11, end: 20 });
      const [late] = await enqueueCells(db, [{ key: "b:d1:2099-07-17:e2", cellKind: "d1" }]);
      await setClock(db, "11:30:00");
      await makeAvailable(db, [late!]);
      expect((await prepare(db, late!)).result).toEqual({
        state: "cancelled",
        reason: "no_shared_care_window",
      });
      expect(await careMessages(db)).toEqual([]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("validates cadence changes and refuses direct client writes", async () => {
    const db = await createDatabase();
    try {
      await expect(setCadence(db, BRIDE_ID, { intensity: "often" })).rejects.toThrow(/AMORA_CARE_CADENCE_INVALID/);
      await expect(setCadence(db, BRIDE_ID, { start: 8 })).rejects.toThrow(/AMORA_CARE_CADENCE_INVALID/);
      await expect(setCadence(db, BRIDE_ID, { end: 21 })).rejects.toThrow(/AMORA_CARE_CADENCE_INVALID/);
      await expect(setCadence(db, BRIDE_ID, { start: 15, end: 15 })).rejects.toThrow(/AMORA_CARE_CADENCE_WINDOW_INVALID/);
      await setCadence(db, BRIDE_ID, { end: 12 });
      await expect(setCadence(db, BRIDE_ID, { start: 13 })).rejects.toThrow(/AMORA_CARE_CADENCE_WINDOW_INVALID/);

      await db.exec("RESET ROLE");
      await db.exec("SET ROLE authenticated");
      await expect(
        db.query(`UPDATE public.profiles SET care_intensity = 'more' WHERE id = '${BRIDE_ID}'`),
      ).rejects.toThrow(/AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN/);
      await expect(
        db.query(`UPDATE public.profiles SET care_window_start_hour = 10 WHERE id = '${BRIDE_ID}'`),
      ).rejects.toThrow(/AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN/);

      await db.exec("RESET ROLE");
      const privileges = await db.query<Record<string, boolean | string | null>>(`
        SELECT
          to_regprocedure('public.prepare_amora_care_job(uuid,uuid,boolean)')::text AS old_prepare,
          has_function_privilege('authenticated',
            'public.set_amora_care_cadence(uuid,text,integer,integer)', 'EXECUTE') AS client_set,
          has_function_privilege('service_role',
            'public.prepare_amora_care_job_pre_cadence(uuid,uuid,boolean)', 'EXECUTE') AS service_inner_prepare,
          has_function_privilege('service_role',
            'public.insert_amora_care_message_pre_cadence(uuid,text,jsonb)', 'EXECUTE') AS service_inner_insert,
          has_function_privilege('service_role',
            'public.cancel_amora_care_job_source_changed(uuid,uuid)', 'EXECUTE') AS service_cancel
      `);
      expect(privileges.rows[0]).toEqual({
        old_prepare: null,
        client_set: false,
        service_inner_prepare: false,
        service_inner_insert: false,
        service_cancel: true,
      });
    } finally {
      await db.close();
    }
  }, 60_000);
});
