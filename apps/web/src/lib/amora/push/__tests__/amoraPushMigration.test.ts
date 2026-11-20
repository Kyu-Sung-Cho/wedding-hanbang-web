// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

// 결정 D-86 의 통과 기준을 저장소의 실제 마이그레이션 위에서 잰다.
//   1. 동의하지 않은 사람에게는 0건(기록도 안 남는다).
//   2. 한국 시각 09~20시 밖, 그 사람이 좁힌 받는 시간 밖에서는 0건.
//   3. 하루 상한(2건)을 넘는 것은 0건. 같은 일은 한 번만.
//   4. 공급자가 "등록되지 않은 기기"라고 한 기기만 해제한다.

const migrationSql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20261120130000_amora_app_push.sql"),
  "utf8",
);

const USER = "10000000-0000-4000-8000-000000000001";
const PARTNER = "10000000-0000-4000-8000-000000000002";
const COUPLE = "20000000-0000-4000-8000-000000000001";
const DEVICE_A = "30000000-0000-4000-8000-00000000000a";
const DEVICE_B = "30000000-0000-4000-8000-00000000000b";
const KST_10AM = "2026-11-20T01:00:00Z";

let db: PGlite | null = null;

afterEach(async () => {
  await db?.close();
  db = null;
});

async function createDatabase(): Promise<PGlite> {
  const instance = await PGlite.create();
  await instance.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid,
      care_window_start_hour smallint,
      care_window_end_hour smallint
    );
    -- 기존 기기 토큰 표와 대상 함수의 필요한 칸만(20260804170000 의 같은 이름).
    CREATE TABLE public.mobile_push_device_tokens (
      installation_id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      push_token text,
      binding_epoch bigint NOT NULL DEFAULT 1,
      revoked_at timestamptz,
      revoke_reason text,
      last_seen_at timestamptz
    );
    CREATE FUNCTION public.get_mobile_push_delivery_targets(p_target_user_id uuid)
    RETURNS TABLE (installation_id uuid, push_token text, platform text, binding_epoch bigint)
    LANGUAGE sql STABLE AS $$
      SELECT token.installation_id, token.push_token, 'android'::text, token.binding_epoch
      FROM public.mobile_push_device_tokens AS token
      WHERE token.user_id = p_target_user_id AND token.revoked_at IS NULL AND token.push_token IS NOT NULL
      ORDER BY token.installation_id
    $$;
    CREATE TABLE public.amora_today_one_preferences (
      user_id uuid PRIMARY KEY, enabled boolean NOT NULL, paused_until timestamptz
    );
    CREATE TABLE public.amora_today_one_recipient_states (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_user_id uuid NOT NULL,
      claimed_for_date date NOT NULL
    );
    INSERT INTO auth.users VALUES ('${USER}'), ('${PARTNER}');
    INSERT INTO public.profiles (id, couple_id) VALUES ('${USER}', '${COUPLE}'), ('${PARTNER}', '${COUPLE}');
  `);
  await instance.exec(migrationSql);
  await setClock(instance, KST_10AM);
  return instance;
}

async function setClock(instance: PGlite, iso: string) {
  await instance.exec(`
    CREATE OR REPLACE FUNCTION public.amora_push_clock() RETURNS timestamptz
    LANGUAGE sql STABLE AS $$ SELECT '${iso}'::timestamptz $$;
  `);
}

async function asUser(instance: PGlite, userId: string, sql: string, params: unknown[] = []) {
  await instance.query("SELECT set_config('test.uid', $1, false)", [userId]);
  await instance.exec("SET ROLE authenticated");
  try {
    return await instance.query<Record<string, unknown>>(sql, params);
  } finally {
    await instance.exec("RESET ROLE");
  }
}

async function asService<T = Record<string, unknown>>(instance: PGlite, sql: string, params: unknown[] = []) {
  await instance.exec("SET ROLE service_role");
  try {
    return await instance.query<T>(sql, params);
  } finally {
    await instance.exec("RESET ROLE");
  }
}

async function consent(instance: PGlite, userId: string, enabled: boolean) {
  const result = await asUser(instance, userId, "SELECT public.set_amora_push_preference($1) AS value", [enabled]);
  return result.rows[0].value as { enabled: boolean; consentedAt: string | null };
}

async function addDevice(instance: PGlite, installationId: string, userId = USER, token = `ExponentPushToken[${installationId.slice(-4)}abcdefghijkl]`) {
  await instance.query(
    "INSERT INTO public.mobile_push_device_tokens (installation_id, user_id, push_token) VALUES ($1, $2, $3)",
    [installationId, userId, token],
  );
}

async function claim(instance: PGlite, dedupeKey: string, userId = USER) {
  const result = await asService<{ value: Record<string, unknown> }>(
    instance,
    "SELECT public.claim_amora_push_delivery($1, 'today_one', $2, 'home') AS value",
    [userId, dedupeKey],
  );
  return result.rows[0].value;
}

async function deliveryCount(instance: PGlite) {
  return Number((await instance.query<{ n: number }>("SELECT count(*)::int AS n FROM public.amora_push_deliveries")).rows[0].n);
}

describe("아모라 앱 알림 마이그레이션(D-86)", () => {
  it("동의는 본인만 켜고 끄며, 표는 앱과 서비스 열쇠 어느 쪽에서도 직접 읽지 못한다", async () => {
    db = await createDatabase();
    expect(await asUser(db, USER, "SELECT public.get_amora_push_preference() AS value").then((r) => r.rows[0].value))
      .toEqual({ enabled: false, consentedAt: null });
    const on = await consent(db, USER, true);
    expect(on.enabled).toBe(true);
    expect(on.consentedAt).toEqual(expect.any(String));
    // 다시 켜도 처음 동의 시각은 그대로다.
    expect((await consent(db, USER, true)).consentedAt).toBe(on.consentedAt);
    expect(await consent(db, USER, false)).toEqual({ enabled: false, consentedAt: null });

    await expect(asUser(db, USER, "SELECT * FROM public.amora_push_preferences")).rejects.toMatchObject({ code: "42501" });
    await expect(asService(db, "SELECT * FROM public.amora_push_deliveries")).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(db, USER, "SELECT public.claim_amora_push_delivery($1, 'today_one', 'today_one:2026-11-20', 'home')", [USER]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(db.query("SELECT set_config('test.uid', '', false)").then(() => asUser(db!, "", "SELECT public.set_amora_push_preference(true)")))
      .rejects.toBeTruthy();
  }, 30_000);

  it("동의하지 않았거나 기기가 없으면 보내지 않고 기록도 남기지 않는다", async () => {
    db = await createDatabase();
    await addDevice(db, DEVICE_A);
    expect(await claim(db, "today_one:2026-11-20")).toEqual({ claimed: false, reason: "not_consented" });
    await consent(db, PARTNER, true);
    expect(await claim(db, "today_one:2026-11-20", PARTNER)).toEqual({ claimed: false, reason: "no_device" });
    expect(await deliveryCount(db)).toBe(0);
  }, 30_000);

  it("한국 시각 09~20시 밖과 그 사람이 좁힌 받는 시간 밖에서는 보내지 않는다", async () => {
    db = await createDatabase();
    await addDevice(db, DEVICE_A);
    await consent(db, USER, true);
    for (const iso of ["2026-11-19T23:59:00Z", "2026-11-20T11:00:00Z", "2026-11-20T14:30:00Z"]) {
      await setClock(db, iso); // KST 08:59, 20:00, 23:30
      expect(await claim(db, `today_one:${iso.slice(0, 13).replace(/[^0-9]/g, "")}`)).toEqual({ claimed: false, reason: "quiet_hours" });
    }
    await setClock(db, KST_10AM);
    await db.exec(`UPDATE public.profiles SET care_window_start_hour = 12 WHERE id = '${USER}'`);
    expect(await claim(db, "today_one:2026-11-20")).toEqual({ claimed: false, reason: "quiet_hours" });
    await setClock(db, "2026-11-20T03:30:00Z"); // KST 12:30
    expect(await claim(db, "today_one:2026-11-20")).toMatchObject({ claimed: true });
    expect(await deliveryCount(db)).toBe(1);
  }, 30_000);

  it("프로필 줄이 없으면 받는 시간을 모르는 것으로 보고 보내지 않고, 보낼 때는 그 사람의 받는 시간이 끝나는 시각을 준다", async () => {
    db = await createDatabase();
    // 동의와 기기는 auth.users 에 걸려 있어 프로필 줄이 없어도 남을 수 있다(가입 중이거나 프로필만 지워진 계정).
    const noProfile = "10000000-0000-4000-8000-000000000003";
    await db.exec(`INSERT INTO auth.users VALUES ('${noProfile}')`);
    await addDevice(db, DEVICE_B, noProfile);
    await consent(db, noProfile, true);
    expect(await claim(db, "today_one:2026-11-20", noProfile)).toEqual({ claimed: false, reason: "quiet_hours" });
    expect(await deliveryCount(db)).toBe(0);
    // 창 함수 자체도 NULL 이 아니라 false 다(아침 대상 목록도 같은 함수를 쓴다).
    const open = await db.query<{ open: boolean | null }>("SELECT public.amora_push_window_open($1) AS open", [noProfile]);
    expect(open.rows[0].open).toBe(false);

    // 보내는 쪽은 이 시각까지로 알림의 유효 시간을 줄인다(꺼진 폰이 오후 6시 뒤에 받지 않게).
    await addDevice(db, DEVICE_A);
    await consent(db, USER, true);
    await db.exec(`UPDATE public.profiles SET care_window_end_hour = 18 WHERE id = '${USER}'`);
    const claimed = await claim(db, "today_one:2026-11-20");
    expect(claimed).toMatchObject({ claimed: true });
    expect(Date.parse(String(claimed.windowEndsAt))).toBe(Date.parse("2026-11-20T18:00:00+09:00"));
    // 좁히지 않은 사람은 오후 8시.
    await addDevice(db, "30000000-0000-4000-8000-00000000000c", PARTNER);
    await consent(db, PARTNER, true);
    const partner = await claim(db, "today_one:2026-11-20", PARTNER);
    expect(Date.parse(String(partner.windowEndsAt))).toBe(Date.parse("2026-11-20T20:00:00+09:00"));
  }, 30_000);

  it("같은 일은 한 번만, 하루 2건까지 보내고 공급자가 거절한 건은 상한에 세지 않는다", async () => {
    db = await createDatabase();
    await addDevice(db, DEVICE_A);
    await addDevice(db, DEVICE_B);
    await consent(db, USER, true);

    const first = await claim(db, "today_one:2026-11-20");
    expect(first).toMatchObject({ claimed: true, deliveryId: expect.any(String) });
    expect((first.targets as unknown[]).length).toBe(2);
    expect(await claim(db, "today_one:2026-11-20")).toEqual({ claimed: false, reason: "duplicate" });

    const second = await claim(db, "task_done:task-1");
    expect(second).toMatchObject({ claimed: true });
    // 두 번째가 공급자에게 거절되면 그 건은 세지 않아 하나를 더 보낼 수 있다.
    const recorded = await asService<{ ok: boolean }>(
      db,
      "SELECT public.record_amora_push_result($1, 0, 'ExpoServerError', '[]'::jsonb) AS ok",
      [second.deliveryId],
    );
    expect(recorded.rows[0].ok).toBe(true);
    expect(await claim(db, "task_done:task-2")).toMatchObject({ claimed: true });
    expect(await claim(db, "task_done:task-3")).toEqual({ claimed: false, reason: "daily_cap" });

    // 다음 날은 다시 보낼 수 있다.
    await setClock(db, "2026-11-21T01:00:00Z");
    expect(await claim(db, "today_one:2026-11-21")).toMatchObject({ claimed: true });
  }, 30_000);

  it("결과는 한 번만 적고, 등록되지 않은 기기는 그 설치와 판만 해제한다", async () => {
    db = await createDatabase();
    await addDevice(db, DEVICE_A);
    await addDevice(db, DEVICE_B);
    await consent(db, USER, true);
    const claimed = await claim(db, "today_one:2026-11-20");

    const wrongEpoch = await asService<{ ok: boolean }>(
      db,
      "SELECT public.record_amora_push_result($1, 1, 'DeviceNotRegistered', $2::jsonb) AS ok",
      [claimed.deliveryId, JSON.stringify([{ installationId: DEVICE_A, bindingEpoch: 1 }])],
    );
    expect(wrongEpoch.rows[0].ok).toBe(true);
    const tokens = await db.query<{ installation_id: string; push_token: string | null; revoke_reason: string | null }>(
      "SELECT installation_id, push_token, revoke_reason FROM public.mobile_push_device_tokens ORDER BY installation_id",
    );
    expect(tokens.rows).toEqual([
      { installation_id: DEVICE_A, push_token: null, revoke_reason: "provider_device_not_registered" },
      { installation_id: DEVICE_B, push_token: expect.stringMatching(/^ExponentPushToken\[/), revoke_reason: null },
    ]);
    const state = await db.query<{ state: string; ticketed_count: number }>(
      "SELECT state, ticketed_count FROM public.amora_push_deliveries",
    );
    expect(state.rows).toEqual([{ state: "ticketed", ticketed_count: 1 }]);

    const again = await asService<{ ok: boolean }>(
      db,
      "SELECT public.record_amora_push_result($1, 1, NULL, '[]'::jsonb) AS ok",
      [claimed.deliveryId],
    );
    expect(again.rows[0].ok).toBe(false);
  }, 30_000);

  it("아침 알림 대상은 두 설정을 다 켰고, 오늘 카드도 알림도 아직 받지 않았고, 받는 시간 안인 사람뿐이다", async () => {
    db = await createDatabase();
    await consent(db, USER, true);
    await consent(db, PARTNER, true);
    await db.exec(`
      INSERT INTO public.amora_today_one_preferences VALUES ('${USER}', true, NULL), ('${PARTNER}', false, NULL);
    `);
    const list = async () => (await asService<{ user_id: string }>(
      db!,
      "SELECT user_id FROM public.list_amora_today_one_push_recipients(50)",
    )).rows.map((row) => row.user_id);

    expect(await list()).toEqual([USER]);
    await db.exec(`INSERT INTO public.amora_today_one_recipient_states (recipient_user_id, claimed_for_date) VALUES ('${USER}', '2026-11-20')`);
    expect(await list()).toEqual([]);
    await setClock(db, "2026-11-21T01:00:00Z");
    expect(await list()).toEqual([USER]);
    await setClock(db, "2026-11-21T12:00:00Z"); // KST 21:00
    expect(await list()).toEqual([]);
  }, 30_000);
});
