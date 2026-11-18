// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_SHORTLIST } from "../hallRepository";

// 합성 PostgreSQL 17 하네스는 Windows 에서 LOCALAPPDATA 가 없으면 불러오는 순간 죽는다. turbo 는 환경변수를 걸러 넘겨서
// 푸시 훅에서는 그 값이 없다(2026-11-18 실측). 그래서 진짜 서버로도 돌리라고 했을 때만 불러온다.
type NativeFixture = typeof import("../../../../../../scripts/tests/fixtures/profile-role-native-database.mjs");
const native: NativeFixture | null = process.env.HANBANG_HALL_INQUIRY_NATIVE_PG === "1"
  ? await import("../../../../../../scripts/tests/fixtures/profile-role-native-database.mjs")
  : null;

/**
 * 20261117090000 웨딩홀·상담 문의 마이그레이션을 실제 PostgreSQL 에 올려 본다.
 *
 * 기본은 PGlite(WASM PostgreSQL)이다. 이 컴퓨터에 합성용 PostgreSQL 17 이 있으면
 * `HANBANG_HALL_INQUIRY_NATIVE_PG=1` 로 같은 시험을 진짜 서버에서도 돌린다(운영 접속 문자열은 받지 않는다).
 * 회원 판정 함수, 알림 표, 계정 삭제 작업 표는 손으로 흉내 내지 않고 실제 마이그레이션 원문에서 꺼내 쓴다.
 */

const MIGRATIONS = resolve(process.cwd(), "../../supabase/migrations");
const readMigration = (name: string) => readFileSync(resolve(MIGRATIONS, name), "utf8");
const SQL = readMigration("20261117090000_hall_listings_and_inquiries.sql");

const BRIDE = "11111111-1111-4111-8111-111111111111";
const GROOM = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const OPERATOR = "44444444-4444-4444-8444-444444444444";
const SOLO = "77777777-7777-4777-8777-777777777777";
const COUPLE = "55555555-5555-4555-8555-555555555555";
const OTHER_COUPLE = "66666666-6666-4666-8666-666666666666";
const SOLO_COUPLE = "88888888-8888-4888-8888-888888888888";

type Rows<T> = { rows: T[] };
type ApproverState = {
  mode: string;
  designatedUserId: string | null;
  revision: number;
  changed: boolean;
  outcome: string;
  pending: { proposalId: string; mode: string; designatedUserId: string | null; proposedBy: string; proposedAt: string } | null;
};
type ApproveResult = { status: string; notQueuedReason: string | null; queuedCount: number; duplicateHallIds: string[]; waitingFor: string[] };
// 회원이 표를 직접 읽어도 보이면 안 되는 운영자 칸.
const HIDDEN_FROM_MEMBERS: readonly [string, string][] = [
  ["hall_listings", "created_by"],
  ["hall_listings", "updated_by"],
  ["hall_inquiry_dispatches", "sent_by"],
  ["hall_inquiry_dispatches", "channel_note"],
  ["hall_inquiry_dispatches", "dispatch_fingerprint"],
  ["hall_inquiry_replies", "recorded_by"],
];
type Engine = {
  exec(sql: string): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<Rows<T>>;
  asRole<T>(role: "anon" | "authenticated" | "service_role", sub: string | null, sql: string, params?: unknown[]): Promise<Rows<T>>;
  close(): Promise<void>;
};

function extract(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern)?.[0];
  if (!match) throw new Error(`${label} not found in the source migration`);
  return match;
}

async function pgliteEngine(): Promise<Engine> {
  const db = await PGlite.create();
  return {
    exec: async (sql) => { await db.exec(sql); },
    query: async <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params) as Promise<Rows<T>>,
    asRole: async <T>(role: string, sub: string | null, sql: string, params: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE ${role}`);
        await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
        return tx.query<T>(sql, params) as Promise<Rows<T>>;
      }),
    close: async () => { await db.close(); },
  };
}

async function nativeEngine(): Promise<Engine> {
  if (!native) throw new Error("native PostgreSQL fixture was not requested");
  const owned = await native.createProfileRoleNativeDatabase();
  const client = owned.client;
  return {
    exec: async (sql) => { await client.query(sql); },
    query: async <T>(sql: string, params: unknown[] = []) => client.query(sql, params) as Promise<Rows<T>>,
    asRole: async <T>(role: string, sub: string | null, sql: string, params: unknown[] = []) => {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
        const result = await client.query(sql, params);
        await client.query("COMMIT");
        return result as Rows<T>;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
    close: async () => { await owned.close(); },
  };
}

async function prepare(engine: Engine) {
  await engine.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TABLE public.couples(id uuid PRIMARY KEY, bride_id uuid, groom_id uuid);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, couple_id uuid, role text, name text,
      is_admin boolean NOT NULL DEFAULT false);
  `);
  const membership = readMigration("20260716114000_current_couple_membership_privacy_fence.sql");
  for (const name of ["is_current_couple_member", "is_couple_member"]) {
    await engine.exec(extract(
      membership,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`),
      name,
    ));
  }
  await engine.exec(`
    REVOKE ALL ON FUNCTION public.is_current_couple_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid, uuid) TO service_role;
    REVOKE ALL ON FUNCTION public.is_couple_member(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated, service_role;
  `);
  await engine.exec(extract(
    readMigration("20260730102000_amora_shared_action_approval_and_notifications.sql"),
    /CREATE TABLE IF NOT EXISTS public\.couple_change_notifications \([\s\S]*?\n\);/,
    "couple_change_notifications table",
  ));
  await engine.exec(extract(
    readMigration("20260731123000_couple_plan_change_write_boundary.sql"),
    /ALTER TABLE public\.couple_change_notifications\s+DROP CONSTRAINT IF EXISTS couple_change_notifications_event_kind_check;[\s\S]*?ADD CONSTRAINT couple_change_notifications_actor_recipient_check CHECK \([\s\S]*?'change_stale'\s*\)\s*\);/,
    "couple_change_notifications constraints",
  ));
  const saga = readMigration("20260716113000_account_deletion_storage_saga.sql");
  await engine.exec(extract(saga, /CREATE TABLE public\.account_deletion_jobs \([\s\S]*?\n\);/, "account_deletion_jobs table"));
  await engine.exec(extract(saga, /CREATE UNIQUE INDEX account_deletion_jobs_active_user_idx[\s\S]*?;/, "account_deletion_jobs active index"));
  await engine.exec(SQL);
}

const engines: ("pglite" | "native")[] = native?.nativeProfileRoleAvailable ? ["pglite", "native"] : ["pglite"];

describe.each(engines)("hall inquiry migration on %s PostgreSQL", (engineName) => {
  let engine: Engine;
  let hallA = "";
  let hallB = "";
  let hallC = "";

  const shares = (overrides: Record<string, unknown> = {}) => ({
    name: { on: false, value: null },
    phone: { on: false, value: null },
    budget: { on: false, value: null },
    ...overrides,
  });

  async function service<T>(sql: string, params: unknown[] = []) {
    return engine.asRole<T>("service_role", null, sql, params);
  }

  async function save(
    actor: string,
    recipients: string[],
    body: string,
    shareValue = shares(),
    letterId: string | null = null,
    signature = "민지와 준호 드림",
  ) {
    const result = await service<{ value: { letterId: string; versionId: string; version: number; fingerprint: string; created: boolean } }>(
      "SELECT public.hall_inquiry_save_letter_version($1, $2, $3, $4::uuid[], $5, $6, $7::jsonb) AS value",
      [COUPLE, actor, letterId, recipients, body, signature, JSON.stringify(shareValue)],
    );
    return result.rows[0].value;
  }

  async function approve(actor: string, versionId: string, fingerprint: string, sending = true, cap = 5, globalCap = 100) {
    const result = await service<{ value: ApproveResult }>(
      "SELECT public.hall_inquiry_approve_letter($1, $2, $3, $4, $5, $6, $7) AS value",
      [COUPLE, actor, versionId, fingerprint, sending, cap, globalCap],
    );
    return result.rows[0].value;
  }

  async function setApprover(actor: string, mode: string, designated: string | null = null, couple = COUPLE) {
    const result = await service<{ value: ApproverState }>(
      "SELECT public.hall_inquiry_set_approver($1, $2, $3, $4) AS value",
      [couple, actor, mode, designated],
    );
    return result.rows[0].value;
  }

  async function respond(actor: string, proposalId: string | undefined, accept: boolean) {
    const result = await service<{ value: ApproverState }>(
      "SELECT public.hall_inquiry_respond_approver($1, $2, $3, $4) AS value",
      [COUPLE, actor, proposalId ?? null, accept],
    );
    return result.rows[0].value;
  }

  async function addListing(name: string, active = true) {
    const result = await service<{ id: string }>(
      `INSERT INTO public.hall_listings (name, region, area_label, kind_label, meal_price_won, rental_fee_won,
         rental_included, minimum_guarantee, station_walk_minutes, transit_note, source_url, checked_on, active)
       VALUES ($1, '서울', '마포구 하우스웨딩', '하우스웨딩', 68000, NULL, true, 180, 8, '역에서 8분',
         'https://example.com/source', DATE '2026-11-14', $2) RETURNING id`,
      [name, active],
    );
    return result.rows[0].id;
  }

  async function pick(hallId: string, couple = COUPLE, actor = BRIDE) {
    await engine.asRole("authenticated", actor,
      "INSERT INTO public.hall_shortlists (couple_id, hall_id, added_by) VALUES ($1, $2, $3)",
      [couple, hallId, actor]);
  }

  async function count(table: string) {
    return Number((await engine.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${table}`)).rows[0].n);
  }

  beforeAll(async () => {
    engine = engineName === "native" ? await nativeEngine() : await pgliteEngine();
    await prepare(engine);
  }, 120_000);

  afterAll(async () => { await engine?.close(); });

  beforeEach(async () => {
    await engine.exec(`
      TRUNCATE public.hall_inquiry_replies, public.hall_inquiry_dispatches, public.hall_inquiry_approvals,
        public.hall_inquiry_letter_versions, public.hall_inquiry_letters, public.hall_inquiry_settings,
        public.hall_shortlists, public.hall_listings, public.couple_change_notifications,
        public.account_deletion_jobs, public.profiles, public.couples, auth.users CASCADE;
    `);
    await engine.query("INSERT INTO auth.users VALUES ($1), ($2), ($3), ($4), ($5)", [BRIDE, GROOM, OUTSIDER, OPERATOR, SOLO]);
    await engine.query(
      `INSERT INTO public.profiles (id, couple_id, role, name, is_admin) VALUES
        ($1, $6, 'bride', '민지', false), ($2, $6, 'groom', '준호', false),
        ($3, $7, 'bride', '다른 사람', false), ($4, NULL, NULL, '운영자', true), ($5, $8, 'bride', '혼자', false)`,
      [BRIDE, GROOM, OUTSIDER, OPERATOR, SOLO, COUPLE, OTHER_COUPLE, SOLO_COUPLE],
    );
    await engine.query(
      "INSERT INTO public.couples VALUES ($1, $2, $3), ($4, $5, NULL), ($6, $7, NULL)",
      [COUPLE, BRIDE, GROOM, OTHER_COUPLE, OUTSIDER, SOLO_COUPLE, SOLO],
    );
    hallA = await addListing("소담 하우스");
    hallB = await addListing("가온 웨딩홀");
    hallC = await addListing("루체 컨벤션");
  });

  it("keeps every table behind RLS, grants reads only, and leaves writes to service functions", async () => {
    const tables = [
      "hall_listings", "hall_shortlists", "hall_inquiry_settings", "hall_inquiry_letters",
      "hall_inquiry_letter_versions", "hall_inquiry_approvals", "hall_inquiry_dispatches", "hall_inquiry_replies",
    ];
    for (const table of tables) {
      const rls = await engine.query<{ enabled: boolean }>(
        "SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = $1::regclass", [`public.${table}`]);
      expect(rls.rows[0].enabled, table).toBe(true);
      const anon = await engine.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('anon', $1, 'SELECT,INSERT,UPDATE,DELETE') AS allowed", [`public.${table}`]);
      expect(anon.rows[0].allowed, `anon on ${table}`).toBe(false);
      const update = await engine.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('authenticated', $1, 'UPDATE') AS allowed", [`public.${table}`]);
      expect(update.rows[0].allowed, `authenticated update on ${table}`).toBe(false);
      const read = await engine.query<{ allowed: boolean }>(
        "SELECT has_any_column_privilege('authenticated', $1, 'SELECT') AS allowed", [`public.${table}`]);
      expect(read.rows[0].allowed, `authenticated read on ${table}`).toBe(true);
    }
    for (const [table, column] of HIDDEN_FROM_MEMBERS) {
      const hidden = await engine.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('authenticated', $1, $2, 'SELECT') AS allowed", [`public.${table}`, column]);
      expect(hidden.rows[0].allowed, `authenticated read on ${table}.${column}`).toBe(false);
    }
    for (const table of tables.filter((name) => name !== "hall_shortlists")) {
      const insert = await engine.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('authenticated', $1, 'INSERT,DELETE') AS allowed", [`public.${table}`]);
      expect(insert.rows[0].allowed, `authenticated write on ${table}`).toBe(false);
    }
    for (const fn of [
      "public.hall_inquiry_save_letter_version(uuid,uuid,uuid,uuid[],text,text,jsonb)",
      "public.hall_inquiry_set_approver(uuid,uuid,text,uuid)",
      "public.hall_inquiry_respond_approver(uuid,uuid,uuid,boolean)",
      "public.hall_inquiry_approve_letter(uuid,uuid,uuid,text,boolean,integer,integer)",
      "public.hall_inquiry_mark_sent(uuid,uuid,text)",
      "public.hall_inquiry_record_reply(uuid,uuid,text,text,timestamptz,text,text)",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const allowed = await engine.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed", [role, fn]);
        expect(allowed.rows[0].allowed, `${role} on ${fn}`).toBe(false);
      }
      const service = await engine.query<{ allowed: boolean }>(
        "SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS allowed", [fn]);
      expect(service.rows[0].allowed, `service_role on ${fn}`).toBe(true);
    }
    for (const internal of [
      "public.hall_inquiry_purge_for_account_deletion()",
      "public.hall_shortlists_enforce_limit()",
      "public.hall_inquiry_drop_approver_proposal(uuid)",
      "public.hall_inquiry_approver_state(uuid,text)",
      "public.hall_inquiry_approver_change_needs_consent(text,uuid,text,uuid,uuid,uuid[])",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const allowed = await engine.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed", [role, internal]);
        expect(allowed.rows[0].allowed, `${role} on ${internal}`).toBe(false);
      }
    }
    const viewer = "public.hall_inquiry_viewer_account_active()";
    const viewerGrants = await engine.query<{ anon: boolean; member: boolean }>(
      "SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS member",
      [viewer]);
    expect(viewerGrants.rows[0]).toEqual({ anon: false, member: true });
  });

  it("shows signed-in members only active listings and refuses member writes to listings", async () => {
    const hidden = await addListing("숨긴 홀", false);
    const visible = await engine.asRole<{ id: string }>("authenticated", BRIDE, "SELECT id FROM public.hall_listings ORDER BY name");
    expect(visible.rows.map((row) => row.id)).not.toContain(hidden);
    expect(visible.rows).toHaveLength(3);
    const anonymous = await engine.asRole<{ id: string }>("anon", null, "SELECT 1 AS id FROM public.hall_listings")
      .catch((error: Error) => error);
    expect(anonymous).toBeInstanceOf(Error);
    await expect(engine.asRole("authenticated", BRIDE,
      `INSERT INTO public.hall_listings (name, region, area_label, kind_label, meal_price_won, rental_included,
        source_url, checked_on) VALUES ('x', '서울', 'x', 'x', 50000, true, 'https://example.com', DATE '2026-11-14')`))
      .rejects.toThrow(/permission denied/);
  });

  it("rejects listings without an https source, with a rental mismatch, or with hidden characters", async () => {
    const insert = (sourceUrl: string, rentalIncluded: boolean, rentalFee: number | null, name = "새 홀") => service(
      `INSERT INTO public.hall_listings (name, region, area_label, kind_label, meal_price_won, rental_fee_won,
         rental_included, source_url, checked_on) VALUES ($1, '서울', '강남구', '단독홀', 75000, $2, $3, $4, DATE '2026-11-14')`,
      [name, rentalFee, rentalIncluded, sourceUrl],
    );
    await expect(insert("http://example.com", false, 3_000_000)).rejects.toThrow(/hall_listings_source_check/);
    await expect(insert("https://example.com", true, 3_000_000)).rejects.toThrow(/hall_listings_rental_check/);
    await expect(insert("https://example.com", false, null)).rejects.toThrow(/hall_listings_rental_check/);
    await expect(insert("https://example.com", false, 3_000_000, "이름​숨김")).rejects.toThrow(/hall_listings_name_check/);
    await expect(insert("https://example.com", false, 3_000_000)).resolves.toBeTruthy();
    // 지역은 커플이 고르는 정본 목록의 짧은 이름만 받는다. 공식 이름이나 구 이름은 비교에서 안 맞으므로 막는다.
    for (const region of ["서울특별시", "마포구", " 서울"]) {
      await expect(service(
        `INSERT INTO public.hall_listings (name, region, area_label, kind_label, meal_price_won, rental_included,
           source_url, checked_on) VALUES ('지역 홀', $1, '마포구', '단독홀', 75000, true, 'https://example.com', DATE '2026-11-14')`,
        [region],
      )).rejects.toThrow(/hall_listings_region_check/);
    }
  });

  it("lets only couple members shortlist active halls for their own couple", async () => {
    await pick(hallA);
    const own = await engine.asRole<{ hall_id: string }>("authenticated", GROOM, "SELECT hall_id FROM public.hall_shortlists");
    expect(own.rows.map((row) => row.hall_id)).toEqual([hallA]);
    const other = await engine.asRole<{ hall_id: string }>("authenticated", OUTSIDER, "SELECT hall_id FROM public.hall_shortlists");
    expect(other.rows).toEqual([]);
    await expect(pick(hallB, OTHER_COUPLE, BRIDE)).rejects.toThrow(/row-level security/);
    await expect(engine.asRole("authenticated", BRIDE,
      "INSERT INTO public.hall_shortlists (couple_id, hall_id, added_by) VALUES ($1, $2, $3)",
      [COUPLE, hallB, GROOM])).rejects.toThrow(/row-level security/);
    const hidden = await addListing("숨긴 홀", false);
    await expect(pick(hidden)).rejects.toThrow(/row-level security/);
  });

  it("creates a new version only when recipients, body or shares change, with a content fingerprint", async () => {
    await pick(hallA);
    await pick(hallB);
    const first = await save(BRIDE, [hallA, hallB], "2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다.");
    expect(first).toMatchObject({ version: 1, created: true });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const same = await save(GROOM, [hallB, hallA], "2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다.");
    expect(same).toMatchObject({ versionId: first.versionId, version: 1, created: false, fingerprint: first.fingerprint });

    const body = await save(BRIDE, [hallA, hallB], "2027년 5월 토요일 낮에 예식을 생각하고 있어요.");
    expect(body.version).toBe(2);
    expect(body.fingerprint).not.toBe(first.fingerprint);

    const recipients = await save(BRIDE, [hallA], "2027년 5월 토요일 낮에 예식을 생각하고 있어요.");
    expect(recipients.version).toBe(3);

    const shared = await save(BRIDE, [hallA], "2027년 5월 토요일 낮에 예식을 생각하고 있어요.",
      shares({ name: { on: true, value: "김민지" } }));
    expect(shared.version).toBe(4);

    const signed = await save(BRIDE, [hallA], "2027년 5월 토요일 낮에 예식을 생각하고 있어요.",
      shares({ name: { on: true, value: "김민지" } }), null, "결혼을 준비하는 두 사람 드림");
    expect(signed.version).toBe(5);
    expect(new Set([first.fingerprint, body.fingerprint, recipients.fingerprint, shared.fingerprint, signed.fingerprint]).size).toBe(5);
    expect(signed.letterId).toBe(first.letterId);
  });

  it("refuses outsiders, unpicked or hidden halls, off shares with values and bad phones", async () => {
    await pick(hallA);
    await expect(service("SELECT public.hall_inquiry_save_letter_version($1, $2, NULL, $3::uuid[], '본문', '드림', $4::jsonb)",
      [COUPLE, OUTSIDER, [hallA], JSON.stringify(shares())])).rejects.toThrow(/HALL_INQUIRY_NOT_COUPLE_MEMBER/);
    await expect(save(BRIDE, [hallA], "본문", shares(), null, "")).rejects.toThrow(/HALL_INQUIRY_BODY_INVALID/);
    await expect(save(BRIDE, [hallB], "본문")).rejects.toThrow(/HALL_INQUIRY_RECIPIENTS_UNAVAILABLE/);
    await expect(save(BRIDE, [hallA, hallA], "본문")).rejects.toThrow(/HALL_INQUIRY_RECIPIENTS_INVALID/);
    await expect(save(BRIDE, [hallA], "본문", shares({ phone: { on: false, value: "010-1234-5678" } })))
      .rejects.toThrow(/HALL_INQUIRY_SHARES_INVALID/);
    await expect(save(BRIDE, [hallA], "본문", shares({ phone: { on: true, value: "02-123-4567" } })))
      .rejects.toThrow(/HALL_INQUIRY_SHARES_INVALID/);
    await expect(save(BRIDE, [hallA], " 앞 공백")).rejects.toThrow(/HALL_INQUIRY_BODY_INVALID/);
    await expect(save(BRIDE, [hallA], "본문", shares({ phone: { on: true, value: "010-1234-5678" } })))
      .resolves.toMatchObject({ created: true });
  });

  it("unset approver: either member approves alone, both are notified, and a second press never queues twice", async () => {
    await pick(hallA);
    await pick(hallB);
    const draft = await save(BRIDE, [hallA, hallB], "상담받고 싶습니다.");
    const result = await approve(GROOM, draft.versionId, draft.fingerprint);
    expect(result).toMatchObject({ status: "queued", queuedCount: 2, duplicateHallIds: [], waitingFor: [] });
    expect(await count("hall_inquiry_dispatches")).toBe(2);

    const notified = await engine.query<{ recipient_user_id: string; event_kind: string }>(
      "SELECT recipient_user_id, event_kind FROM public.couple_change_notifications WHERE tool_name = 'hall_inquiry_letter' ORDER BY recipient_user_id");
    expect(notified.rows.map((row) => row.recipient_user_id).sort()).toEqual([BRIDE, GROOM].sort());
    expect(new Set(notified.rows.map((row) => row.event_kind))).toEqual(new Set(["change_applied"]));

    const again = await approve(BRIDE, draft.versionId, draft.fingerprint);
    expect(again).toMatchObject({ status: "queued", queuedCount: 2 });
    expect(await count("hall_inquiry_dispatches")).toBe(2);
    await expect(save(BRIDE, [hallA, hallB], "다른 글", shares(), draft.letterId)).rejects.toThrow(/HALL_INQUIRY_LETTER_LOCKED/);
  });

  it("stores the approval but queues nothing while the inquiry switch is off, then queues only on a fresh approval", async () => {
    await pick(hallA);
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    const off = await approve(BRIDE, draft.versionId, draft.fingerprint, false);
    expect(off).toMatchObject({ status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0 });
    expect(await count("hall_inquiry_dispatches")).toBe(0);
    expect(await count("hall_inquiry_approvals")).toBe(1);

    // 켜진 뒤 다시 누른 것은 켜진 동안의 새 승인으로 따로 남는다. 꺼진 동안의 승인은 저장된 선택으로 그대로 있다.
    const on = await approve(BRIDE, draft.versionId, draft.fingerprint, true);
    expect(on).toMatchObject({ status: "queued", queuedCount: 1 });
    const kinds = await engine.query<{ sending_enabled: boolean }>(
      "SELECT sending_enabled FROM public.hall_inquiry_approvals ORDER BY sending_enabled");
    expect(kinds.rows.map((row) => row.sending_enabled)).toEqual([false, true]);
  });

  it("refuses an approval for a superseded version or a changed fingerprint", async () => {
    await pick(hallA);
    const first = await save(BRIDE, [hallA], "처음 글");
    await expect(approve(BRIDE, first.versionId, "0".repeat(64))).rejects.toThrow(/HALL_INQUIRY_VERSION_CHANGED/);
    await save(GROOM, [hallA], "고친 글");
    await expect(approve(BRIDE, first.versionId, first.fingerprint)).rejects.toThrow(/HALL_INQUIRY_VERSION_CHANGED/);
    expect(await count("hall_inquiry_dispatches")).toBe(0);
  });

  it("never queues the same content to the same hall twice, even from a new letter", async () => {
    await pick(hallA);
    await pick(hallB);
    const first = await save(BRIDE, [hallA], "같은 글");
    await approve(BRIDE, first.versionId, first.fingerprint);
    const second = await save(BRIDE, [hallA, hallB], "같은 글");
    expect(second.letterId).not.toBe(first.letterId);
    const result = await approve(BRIDE, second.versionId, second.fingerprint);
    expect(result).toMatchObject({ status: "queued", queuedCount: 1, duplicateHallIds: [hallA] });
    const dispatched = await engine.query<{ hall_id: string }>("SELECT hall_id FROM public.hall_inquiry_dispatches ORDER BY queued_at");
    expect(dispatched.rows.map((row) => row.hall_id)).toEqual([hallA, hallB]);
  });

  it("holds a whole letter back when it would pass the daily cap", async () => {
    await pick(hallA);
    await pick(hallB);
    await pick(hallC);
    const draft = await save(BRIDE, [hallA, hallB, hallC], "상담받고 싶습니다.");
    const capped = await approve(BRIDE, draft.versionId, draft.fingerprint, true, 2);
    expect(capped).toMatchObject({ status: "approved_not_queued", notQueuedReason: "daily_cap", queuedCount: 0 });
    expect(await count("hall_inquiry_dispatches")).toBe(0);
    const zero = await approve(BRIDE, draft.versionId, draft.fingerprint, true, 0);
    expect(zero.notQueuedReason).toBe("daily_cap");
    const allowed = await approve(BRIDE, draft.versionId, draft.fingerprint, true, 3);
    expect(allowed).toMatchObject({ status: "queued", queuedCount: 3 });
  });

  it("designated approver: the other member's approval waits and asks the chosen person", async () => {
    await pick(hallA);
    expect(await setApprover(BRIDE, "designated", GROOM)).toMatchObject({ mode: "designated", revision: 1, changed: true });
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    const waiting = await approve(BRIDE, draft.versionId, draft.fingerprint);
    expect(waiting).toMatchObject({ status: "awaiting_approval", waitingFor: [GROOM], queuedCount: 0 });
    // 정한 사람이 아니면 승인 줄을 남기지 않는다. 정한 사람에게 확인을 부탁하는 알림만 간다.
    expect(await count("hall_inquiry_approvals")).toBe(0);
    // 다른 길로 들어온 승인 줄이 있어도 정한 사람의 승인이 아니면 세지 않는다.
    await service(
      `INSERT INTO public.hall_inquiry_approvals (version_id, couple_id, approver_user_id, fingerprint, settings_revision, sending_enabled)
       VALUES ($1, $2, $3, $4, 1, true)`,
      [draft.versionId, COUPLE, BRIDE, draft.fingerprint]);
    expect(await approve(BRIDE, draft.versionId, draft.fingerprint)).toMatchObject({ status: "awaiting_approval", waitingFor: [GROOM] });
    await service("DELETE FROM public.hall_inquiry_approvals WHERE approver_user_id = $1", [BRIDE]);
    const asked = await engine.query<{ recipient_user_id: string; event_kind: string }>(
      "SELECT recipient_user_id, event_kind FROM public.couple_change_notifications WHERE tool_name = 'hall_inquiry_letter'");
    expect(asked.rows).toEqual([{ recipient_user_id: GROOM, event_kind: "approval_requested" }]);
    const done = await approve(GROOM, draft.versionId, draft.fingerprint);
    expect(done).toMatchObject({ status: "queued", queuedCount: 1 });
    expect(await count("hall_inquiry_approvals")).toBe(1);
    await expect(setApprover(BRIDE, "designated", OUTSIDER)).rejects.toThrow(/HALL_INQUIRY_APPROVER_NOT_MEMBER/);
  });

  it("both approvers: queues only after both approve the same version, and a confirmed settings change resets approvals", async () => {
    await pick(hallA);
    await setApprover(GROOM, "both");
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    expect(await approve(BRIDE, draft.versionId, draft.fingerprint)).toMatchObject({ status: "awaiting_approval", waitingFor: [GROOM] });

    // 승인 방식이 바뀌면 앞 방식의 승인은 세지 않는다. 두 사람 모두에서 바꾸는 것이라 상대가 확인한다.
    const toBride = await setApprover(GROOM, "designated", BRIDE);
    expect(toBride).toMatchObject({ mode: "both", revision: 1, outcome: "proposed" });
    expect(await respond(BRIDE, toBride.pending?.proposalId, true)).toMatchObject({ mode: "designated", revision: 2 });
    expect(await count("hall_inquiry_dispatches")).toBe(0);
    const backToBoth = await setApprover(GROOM, "both");
    expect(backToBoth).toMatchObject({ mode: "designated", outcome: "proposed" });
    expect(await respond(BRIDE, backToBoth.pending?.proposalId, true)).toMatchObject({ mode: "both", revision: 3 });
    expect(await approve(GROOM, draft.versionId, draft.fingerprint)).toMatchObject({ status: "awaiting_approval", waitingFor: [BRIDE] });
    expect(await approve(BRIDE, draft.versionId, draft.fingerprint)).toMatchObject({ status: "queued", queuedCount: 1 });
  });

  it("refuses 'both' without a partner and reports an unavailable designated approver", async () => {
    await expect(service("SELECT public.hall_inquiry_set_approver($1, $2, 'both', NULL)", [SOLO_COUPLE, SOLO]))
      .rejects.toThrow(/HALL_INQUIRY_APPROVER_PARTNER_REQUIRED/);
    await pick(hallA);
    await setApprover(BRIDE, "designated", GROOM);
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    await engine.query("UPDATE public.profiles SET couple_id = NULL WHERE id = $1", [GROOM]);
    expect(await approve(BRIDE, draft.versionId, draft.fingerprint)).toMatchObject({
      status: "awaiting_approval",
      notQueuedReason: "approver_unavailable",
    });
  });

  it("marks older approval requests stale when a new version replaces them", async () => {
    await pick(hallA);
    await setApprover(BRIDE, "both");
    const first = await save(BRIDE, [hallA], "처음 글");
    await approve(BRIDE, first.versionId, first.fingerprint);
    await save(BRIDE, [hallA], "고친 글");
    const rows = await engine.query<{ event_kind: string }>(
      "SELECT event_kind FROM public.couple_change_notifications WHERE action_id = $1", [first.versionId]);
    expect(rows.rows.map((row) => row.event_kind)).toEqual(["change_stale"]);
  });

  it("keeps versions, approvals and sent dispatches append-only", async () => {
    await pick(hallA);
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    await approve(BRIDE, draft.versionId, draft.fingerprint);
    await expect(service("UPDATE public.hall_inquiry_letter_versions SET body = '바꾼 글' WHERE id = $1", [draft.versionId]))
      .rejects.toThrow(/HALL_INQUIRY_RECORD_IMMUTABLE/);
    await expect(service("UPDATE public.hall_inquiry_approvals SET fingerprint = $1", ["0".repeat(64)]))
      .rejects.toThrow(/HALL_INQUIRY_RECORD_IMMUTABLE/);
    const dispatch = (await engine.query<{ id: string }>("SELECT id FROM public.hall_inquiry_dispatches")).rows[0].id;
    await expect(service("UPDATE public.hall_inquiry_dispatches SET recipient_name = '다른 곳' WHERE id = $1", [dispatch]))
      .rejects.toThrow(/HALL_INQUIRY_RECORD_IMMUTABLE/);

    // 내용은 탈퇴로 지울 때만 비울 수 있고, 지운 것을 되살리거나 다른 값으로 바꾸는 길은 없다.
    await expect(service("UPDATE public.hall_inquiry_letter_versions SET body = NULL WHERE id = $1", [draft.versionId]))
      .rejects.toThrow(/hall_inquiry_letter_versions_body_check/);
    await expect(service("UPDATE public.hall_inquiry_dispatches SET status = 'withdrawn', withdrawn_at = now() WHERE id = $1", [dispatch]))
      .rejects.toThrow(/hall_inquiry_dispatches_withdrawn_check/);
    await service(
      `UPDATE public.hall_inquiry_letter_versions
          SET body = NULL, signature = NULL, shares = NULL, fingerprint = NULL, redacted_at = now() WHERE id = $1`,
      [draft.versionId]);
    await expect(service("UPDATE public.hall_inquiry_letter_versions SET redacted_at = NULL WHERE id = $1", [draft.versionId]))
      .rejects.toThrow(/HALL_INQUIRY_RECORD_IMMUTABLE/);
    await expect(service("UPDATE public.hall_inquiry_letter_versions SET body = '되살린 글' WHERE id = $1", [draft.versionId]))
      .rejects.toThrow(/HALL_INQUIRY_RECORD_IMMUTABLE/);
    await service("SELECT public.hall_inquiry_mark_sent($1, $2, '공식 문의 폼')", [dispatch, OPERATOR]);
    await expect(service(
      "UPDATE public.hall_inquiry_dispatches SET status = 'withdrawn', withdrawn_at = now(), redacted_at = now(), dispatch_fingerprint = NULL, channel_note = NULL WHERE id = $1",
      [dispatch])).rejects.toThrow(/HALL_INQUIRY_RECORD_IMMUTABLE/);
  });

  it("lets only an operator mark a dispatch sent and record replies after sending", async () => {
    await pick(hallA);
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    await approve(BRIDE, draft.versionId, draft.fingerprint);
    const dispatch = (await engine.query<{ id: string }>("SELECT id FROM public.hall_inquiry_dispatches")).rows[0].id;
    const reply = (operator: string, outcome: string, eventAt: string | null) => service<{ value: { replyId: string; created: boolean } }>(
      "SELECT public.hall_inquiry_record_reply($1, $2, '11월 22일 일요일 오전 11시 가능합니다.', $3, $4::timestamptz, '2층 상담실', NULL) AS value",
      [dispatch, operator, outcome, eventAt]);

    await expect(reply(OPERATOR, "confirmed_time", "2026-11-22T02:00:00Z")).rejects.toThrow(/HALL_INQUIRY_REPLY_BEFORE_SENT/);
    await expect(service("SELECT public.hall_inquiry_mark_sent($1, $2, '공식 문의 폼')", [dispatch, BRIDE]))
      .rejects.toThrow(/HALL_INQUIRY_OPERATOR_REQUIRED/);
    const sent = await service<{ value: { alreadySent: boolean } }>(
      "SELECT public.hall_inquiry_mark_sent($1, $2, '공식 문의 폼') AS value", [dispatch, OPERATOR]);
    expect(sent.rows[0].value.alreadySent).toBe(false);
    const sentAgain = await service<{ value: { alreadySent: boolean } }>(
      "SELECT public.hall_inquiry_mark_sent($1, $2, '다른 메모') AS value", [dispatch, OPERATOR]);
    expect(sentAgain.rows[0].value.alreadySent).toBe(true);
    await expect(service("UPDATE public.hall_inquiry_dispatches SET channel_note = '고친 메모' WHERE id = $1", [dispatch]))
      .rejects.toThrow(/HALL_INQUIRY_RECORD_IMMUTABLE/);

    await expect(reply(OPERATOR, "confirmed_time", null)).rejects.toThrow(/hall_inquiry_replies_event_check/);
    const first = await reply(OPERATOR, "confirmed_time", "2026-11-22T02:00:00Z");
    expect(first.rows[0].value.created).toBe(true);
    const duplicate = await reply(OPERATOR, "confirmed_time", "2026-11-22T02:00:00Z");
    expect(duplicate.rows[0].value).toEqual({ replyId: first.rows[0].value.replyId, created: false });
    const notified = await engine.query<{ recipient_user_id: string }>(
      "SELECT recipient_user_id FROM public.couple_change_notifications WHERE tool_name = 'hall_inquiry_reply'");
    expect(notified.rows.map((row) => row.recipient_user_id).sort()).toEqual([BRIDE, GROOM].sort());
  });

  it("erases the leaving member's letter text, shares, fingerprints and approvals when the deletion job starts", async () => {
    await pick(hallA);
    await pick(hallB, COUPLE, GROOM);
    await pick(hallC, OTHER_COUPLE, OUTSIDER);
    // 첫 편지: 신부가 쓰고 신랑이 승인해 두 곳이 대기열에 들어간다. 한 곳은 운영자가 보내고 답장을 적는다.
    const first = await save(BRIDE, [hallA, hallB], "2027년 5월에 상담받고 싶습니다. 준호 010-9876-5432로 연락 주세요.",
      shares({ name: { on: true, value: "김민지" }, phone: { on: true, value: "010-1234-5678" } }));
    expect(await approve(GROOM, first.versionId, first.fingerprint)).toMatchObject({ status: "queued", queuedCount: 2 });
    const queuedRows = (await engine.query<{ id: string; hall_id: string }>("SELECT id, hall_id FROM public.hall_inquiry_dispatches")).rows;
    const sentId = queuedRows.find((row) => row.hall_id === hallA)?.id as string;
    const heldId = queuedRows.find((row) => row.hall_id === hallB)?.id as string;
    await service("SELECT public.hall_inquiry_mark_sent($1, $2, '공식 문의 폼, 준호 님 번호로 회신 요청')", [sentId, OPERATOR]);
    await service(
      "SELECT public.hall_inquiry_record_reply($1, $2, $3, 'confirmed_time', '2026-11-22T02:00:00Z', '2층 상담실', $4)",
      [sentId, OPERATOR, "김민지 님, 준호 님과 11월 22일 오전 11시에 뵐게요.", "준호 님께 식대 6.8만 원 안내"]);
    // 두 번째 편지: 두 사람 승인으로 바꾼 뒤 신랑이 쓰고 승인해 신부의 승인을 기다린다.
    await setApprover(GROOM, "both");
    const second = await save(GROOM, [hallA], "토요일 저녁도 괜찮을까요? 준호 드림");
    expect(await approve(GROOM, second.versionId, second.fingerprint)).toMatchObject({ status: "awaiting_approval", waitingFor: [BRIDE] });
    // 승인할 사람을 신랑으로 정한다(두 사람 모두에서 바꾸는 것이라 신랑이 확인한다).
    const handOver = await setApprover(BRIDE, "designated", GROOM);
    await respond(GROOM, handOver.pending?.proposalId, true);
    // 신부가 다시 둘 중 아무나로 바꾸자고 한 제안이 신랑의 확인을 기다리는 중이다.
    expect((await setApprover(BRIDE, "unset")).outcome).toBe("proposed");
    // 다른 커플의 편지는 그대로 남아야 한다.
    const other = (await service<{ value: { versionId: string } }>(
      "SELECT public.hall_inquiry_save_letter_version($1, $2, NULL, $3::uuid[], '다른 커플 편지', '다른 사람 드림', $4::jsonb) AS value",
      [OTHER_COUPLE, OUTSIDER, [hallC], JSON.stringify(shares())])).rows[0].value;

    await engine.query("INSERT INTO public.account_deletion_jobs (user_id, reason) VALUES ($1, 'privacy')", [GROOM]);

    const versions = await engine.query<{ body: string | null; signature: string | null; shares: unknown; fingerprint: string | null; redacted: boolean; created_by: string | null }>(
      `SELECT body, signature, shares, fingerprint, redacted_at IS NOT NULL AS redacted, created_by
         FROM public.hall_inquiry_letter_versions WHERE couple_id = $1`, [COUPLE]);
    expect(versions.rows).toHaveLength(2);
    for (const row of versions.rows) {
      expect(row).toMatchObject({ body: null, signature: null, shares: null, fingerprint: null, redacted: true });
      expect(row.created_by).not.toBe(GROOM);
    }
    const letters = await engine.query<{ locked: boolean; created_by: string | null }>(
      "SELECT locked_at IS NOT NULL AS locked, created_by FROM public.hall_inquiry_letters WHERE couple_id = $1", [COUPLE]);
    expect(letters.rows).toHaveLength(2);
    expect(letters.rows.every((row) => row.locked && row.created_by !== GROOM)).toBe(true);
    const approvals = await engine.query<{ approver_user_id: string | null; fingerprint: string | null }>(
      "SELECT approver_user_id, fingerprint FROM public.hall_inquiry_approvals");
    expect(approvals.rows).toHaveLength(2);
    expect(approvals.rows.every((row) => row.approver_user_id !== GROOM && row.fingerprint === null)).toBe(true);
    const dispatched = await engine.query<{ id: string; status: string; dispatch_fingerprint: string | null; channel_note: string | null; withdrawn: boolean; sent: boolean; redacted: boolean }>(
      `SELECT id, status, dispatch_fingerprint, channel_note, withdrawn_at IS NOT NULL AS withdrawn,
              sent_at IS NOT NULL AS sent, redacted_at IS NOT NULL AS redacted FROM public.hall_inquiry_dispatches`);
    expect(dispatched.rows.find((row) => row.id === heldId)).toMatchObject({
      status: "withdrawn", withdrawn: true, sent: false, dispatch_fingerprint: null, redacted: true,
    });
    expect(dispatched.rows.find((row) => row.id === sentId)).toMatchObject({
      status: "sent", withdrawn: false, sent: true, dispatch_fingerprint: null, channel_note: null, redacted: true,
    });
    const replies = await engine.query<{ raw_text: string | null; outcome: string; place_note: string | null; price_note: string | null; has_time: boolean }>(
      "SELECT raw_text, outcome, place_note, price_note, event_at IS NOT NULL AS has_time FROM public.hall_inquiry_replies");
    expect(replies.rows).toEqual([{ raw_text: null, outcome: "confirmed_time", place_note: null, price_note: null, has_time: true }]);
    const setting = await engine.query<{ approver_mode: string; designated_user_id: string | null; revision: number; updated_by: string | null; proposal_id: string | null }>(
      "SELECT approver_mode, designated_user_id, revision::int AS revision, updated_by, proposal_id FROM public.hall_inquiry_settings");
    expect(setting.rows).toEqual([{ approver_mode: "unset", designated_user_id: null, revision: 3, updated_by: null, proposal_id: null }]);
    const picks = await engine.query<{ added_by: string | null }>(
      "SELECT added_by FROM public.hall_shortlists WHERE couple_id = $1 ORDER BY added_by NULLS LAST", [COUPLE]);
    expect(picks.rows).toEqual([{ added_by: BRIDE }, { added_by: null }]);
    const stale = await engine.query<{ recipient_user_id: string; event_kind: string }>(
      "SELECT recipient_user_id, event_kind FROM public.couple_change_notifications WHERE action_id = $1", [second.versionId]);
    expect(stale.rows).toEqual([{ recipient_user_id: BRIDE, event_kind: "change_stale" }]);
    const untouched = await engine.query<{ body: string | null }>(
      "SELECT body FROM public.hall_inquiry_letter_versions WHERE id = $1", [other.versionId]);
    expect(untouched.rows).toEqual([{ body: "다른 커플 편지" }]);

    // 삭제 작업이 끝까지 가도(인증 계정 삭제, 작업 완료) 이 기능의 표와 알림에 떠난 사람의 흔적이 없다.
    await engine.query("UPDATE public.couples SET groom_id = NULL WHERE id = $1", [COUPLE]);
    await engine.query("DELETE FROM public.profiles WHERE id = $1", [GROOM]);
    await engine.query("DELETE FROM auth.users WHERE id = $1", [GROOM]);
    await engine.query(
      `UPDATE public.account_deletion_jobs
          SET status = 'completed', user_id = NULL, reason = NULL, completed_at = now(), auth_deleted_at = now()
        WHERE user_id = $1`, [GROOM]);
    const dump = await engine.query<{ data: string }>(
      `SELECT concat_ws(' ',
         (SELECT jsonb_agg(item)::text FROM public.hall_inquiry_letters AS item WHERE couple_id = $1),
         (SELECT jsonb_agg(item)::text FROM public.hall_inquiry_letter_versions AS item WHERE couple_id = $1),
         (SELECT jsonb_agg(item)::text FROM public.hall_inquiry_approvals AS item WHERE couple_id = $1),
         (SELECT jsonb_agg(item)::text FROM public.hall_inquiry_dispatches AS item WHERE couple_id = $1),
         (SELECT jsonb_agg(item)::text FROM public.hall_inquiry_replies AS item WHERE couple_id = $1),
         (SELECT jsonb_agg(item)::text FROM public.hall_inquiry_settings AS item WHERE couple_id = $1),
         (SELECT jsonb_agg(item)::text FROM public.hall_shortlists AS item WHERE couple_id = $1),
         (SELECT jsonb_agg(item)::text FROM public.couple_change_notifications AS item WHERE couple_id = $1)
       ) AS data`, [COUPLE]);
    expect(dump.rows[0].data.length).toBeGreaterThan(0);
    for (const trace of [GROOM, "준호", "010-9876-5432", "010-1234-5678", "김민지", "민지와"]) {
      expect(dump.rows[0].data, trace).not.toContain(trace);
    }

    // 남은 사람은 새 편지로 다시 시작해 혼자 승인할 수 있다.
    const fresh = await save(BRIDE, [hallA], "다시 문의드립니다.", shares(), null, "민지 드림");
    expect(fresh).toMatchObject({ version: 1, created: true });
    expect([first.letterId, second.letterId]).not.toContain(fresh.letterId);
    expect(await approve(BRIDE, fresh.versionId, fresh.fingerprint)).toMatchObject({ status: "queued", queuedCount: 1 });
  });

  it("refuses inquiry writes from either member while a deletion is pending and closes the erased dispatches", async () => {
    await pick(hallA);
    await pick(hallB);
    const draft = await save(BRIDE, [hallA, hallB], "상담받고 싶습니다.");
    await approve(BRIDE, draft.versionId, draft.fingerprint);
    const rows = (await engine.query<{ id: string; hall_id: string }>("SELECT id, hall_id FROM public.hall_inquiry_dispatches")).rows;
    const sentId = rows.find((row) => row.hall_id === hallA)?.id as string;
    const heldId = rows.find((row) => row.hall_id === hallB)?.id as string;
    await service("SELECT public.hall_inquiry_mark_sent($1, $2, '공식 문의 폼')", [sentId, OPERATOR]);

    await engine.query("INSERT INTO public.account_deletion_jobs (user_id, reason) VALUES ($1, 'unknown')", [BRIDE]);

    await expect(save(GROOM, [hallA], "남은 사람이 새로 쓰는 편지")).rejects.toThrow(/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/);
    await expect(save(BRIDE, [hallA], "떠나는 사람의 남은 로그인")).rejects.toThrow(/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/);
    await expect(setApprover(GROOM, "designated", GROOM)).rejects.toThrow(/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/);
    await expect(approve(GROOM, draft.versionId, "0".repeat(64))).rejects.toThrow(/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/);
    await expect(service("SELECT public.hall_inquiry_mark_sent($1, $2, NULL)", [heldId, OPERATOR]))
      .rejects.toThrow(/HALL_INQUIRY_DISPATCH_WITHDRAWN/);
    await expect(service(
      "SELECT public.hall_inquiry_record_reply($1, $2, '민지 님, 답장드려요.', 'question', NULL, NULL, NULL)",
      [sentId, OPERATOR])).rejects.toThrow(/HALL_INQUIRY_DISPATCH_WITHDRAWN/);
    expect(await count("hall_inquiry_replies")).toBe(0);

    // 떠나는 사람의 남은 로그인으로는 홀을 담지 못한다. 남은 사람은 담을 수 있다.
    await expect(pick(hallC, COUPLE, BRIDE)).rejects.toThrow(/row-level security/);
    await expect(pick(hallC, COUPLE, GROOM)).resolves.toBeUndefined();

    // 삭제 단계가 다시 지나가도 결과는 같다.
    await engine.query("UPDATE public.account_deletion_jobs SET status = 'inventory_ready' WHERE user_id = $1", [BRIDE]);
    const statuses = await engine.query<{ status: string }>("SELECT status FROM public.hall_inquiry_dispatches ORDER BY status");
    expect(statuses.rows.map((row) => row.status)).toEqual(["sent", "withdrawn"]);
  });

  it("erases letters a leaving member wrote or approved in an earlier couple but keeps that couple's later letters", async () => {
    await pick(hallA);
    await pick(hallB);
    await pick(hallC);
    // 신랑이 쓰고 신부가 승인한 편지, 신부가 쓰고 신랑이 승인한 편지. 둘 다 신랑의 흔적이다.
    const written = await save(GROOM, [hallA], "준호가 쓴 편지");
    await approve(BRIDE, written.versionId, written.fingerprint);
    const approved = await save(BRIDE, [hallB], "민지가 쓰고 준호가 승인한 편지");
    await approve(GROOM, approved.versionId, approved.fingerprint);
    // 신랑이 커플을 떠나 다른 커플로 옮긴 뒤, 남은 신부가 혼자 새 편지를 쓴다.
    await engine.query("UPDATE public.couples SET groom_id = NULL WHERE id = $1", [COUPLE]);
    await engine.query("UPDATE public.couples SET groom_id = $2 WHERE id = $1", [SOLO_COUPLE, GROOM]);
    await engine.query("UPDATE public.profiles SET couple_id = $2, role = 'groom' WHERE id = $1", [GROOM, SOLO_COUPLE]);
    const later = await save(BRIDE, [hallC], "신부가 나중에 쓴 편지", shares(), null, "민지 드림");

    await engine.query("INSERT INTO public.account_deletion_jobs (user_id, reason) VALUES ($1, 'other')", [GROOM]);

    const rows = await engine.query<{ id: string; body: string | null }>(
      "SELECT id, body FROM public.hall_inquiry_letter_versions WHERE couple_id = $1", [COUPLE]);
    expect(rows.rows.find((row) => row.id === written.versionId)?.body).toBeNull();
    expect(rows.rows.find((row) => row.id === approved.versionId)?.body).toBeNull();
    expect(rows.rows.find((row) => row.id === later.versionId)?.body).toBe("신부가 나중에 쓴 편지");
    const withdrawn = await engine.query<{ status: string }>("SELECT status FROM public.hall_inquiry_dispatches ORDER BY status");
    expect(withdrawn.rows).toEqual([{ status: "withdrawn" }, { status: "withdrawn" }]);
  });

  it("a change that takes approval power from the partner waits for the partner's confirmation", async () => {
    await pick(hallA);
    // 신랑이 두 사람 모두로 정한다. 신부에게 거부권이 생기는 변경이라 바로 쓰인다.
    expect(await setApprover(GROOM, "both")).toMatchObject({ mode: "both", revision: 1, outcome: "applied", pending: null });
    // 신부가 혼자 승인하는 방식으로 되돌리려 해도 신랑이 확인할 때까지 두 사람 모두가 그대로다.
    const proposed = await setApprover(BRIDE, "unset");
    expect(proposed).toMatchObject({
      mode: "both", revision: 1, outcome: "proposed", changed: false,
      pending: { mode: "unset", designatedUserId: null, proposedBy: BRIDE },
    });
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    expect(await approve(BRIDE, draft.versionId, draft.fingerprint)).toMatchObject({ status: "awaiting_approval", waitingFor: [GROOM] });
    expect(await count("hall_inquiry_dispatches")).toBe(0);
    // 신랑에게만 확인 요청이 가고 알림에는 이름이 없다.
    const asked = await engine.query<{ recipient_user_id: string; event_kind: string; text: string }>(
      "SELECT recipient_user_id, event_kind, title || ' ' || message AS text FROM public.couple_change_notifications WHERE action_id = $1",
      [proposed.pending?.proposalId]);
    expect(asked.rows.map((row) => [row.recipient_user_id, row.event_kind])).toEqual([[GROOM, "approval_requested"]]);
    expect(asked.rows[0].text).not.toMatch(/민지|준호/);
    // 신랑이 확인하면 바뀐다. 앞 방식에서 받은 승인은 세지 않으므로 다시 승인해야 보낸다.
    expect(await respond(GROOM, proposed.pending?.proposalId, true))
      .toMatchObject({ mode: "unset", revision: 2, outcome: "confirmed", pending: null });
    const closed = await engine.query<{ event_kind: string }>(
      "SELECT event_kind FROM public.couple_change_notifications WHERE action_id = $1", [proposed.pending?.proposalId]);
    expect(closed.rows.map((row) => row.event_kind)).toEqual(["change_stale"]);
    expect(await approve(BRIDE, draft.versionId, draft.fingerprint)).toMatchObject({ status: "queued", queuedCount: 1 });
  });

  it("the partner can decline, and a chosen approver keeps the role until they agree", async () => {
    // 신부가 신랑을 승인할 사람으로 정한다. 신랑에게 권한을 주는 변경이라 바로 쓰인다.
    expect(await setApprover(BRIDE, "designated", GROOM))
      .toMatchObject({ mode: "designated", designatedUserId: GROOM, revision: 1, outcome: "applied" });
    // 신부가 다시 둘 중 아무나로 바꾸려면 신랑이 확인해야 한다. 거절하면 그대로이고 제안한 사람에게 알린다.
    const proposed = await setApprover(BRIDE, "unset");
    expect(proposed).toMatchObject({ mode: "designated", outcome: "proposed", pending: { mode: "unset", proposedBy: BRIDE } });
    expect(await respond(GROOM, proposed.pending?.proposalId, false))
      .toMatchObject({ mode: "designated", designatedUserId: GROOM, revision: 1, outcome: "declined", pending: null });
    const told = await engine.query<{ recipient_user_id: string }>(
      "SELECT recipient_user_id FROM public.couple_change_notifications WHERE tool_name = 'hall_inquiry_approver' AND event_kind = 'change_rejected'");
    expect(told.rows).toEqual([{ recipient_user_id: BRIDE }]);
    // 정한 사람이 스스로 내려놓는 것은 바로 쓰인다.
    expect(await setApprover(GROOM, "unset")).toMatchObject({ mode: "unset", revision: 2, outcome: "applied" });
    // 둘 중 아무나에서 자기만 승인하는 사람이 되는 것은 상대가 확인해야 한다. 같은 방식을 상대가 고르면 확인한 것이다.
    expect(await setApprover(GROOM, "designated", GROOM))
      .toMatchObject({ mode: "unset", outcome: "proposed", pending: { mode: "designated", designatedUserId: GROOM } });
    expect(await setApprover(BRIDE, "designated", GROOM))
      .toMatchObject({ mode: "designated", designatedUserId: GROOM, revision: 3, outcome: "confirmed" });
  });

  it("changes that give the partner more say, or that a sole member makes, apply at once", async () => {
    expect(await setApprover(BRIDE, "designated", GROOM)).toMatchObject({ mode: "designated", revision: 1, outcome: "applied" });
    expect(await setApprover(GROOM, "designated", BRIDE)).toMatchObject({ designatedUserId: BRIDE, revision: 2, outcome: "applied" });
    expect(await setApprover(BRIDE, "unset")).toMatchObject({ mode: "unset", revision: 3, outcome: "applied" });
    expect(await setApprover(BRIDE, "both")).toMatchObject({ mode: "both", revision: 4, outcome: "applied" });
    expect(await setApprover(SOLO, "designated", SOLO, SOLO_COUPLE))
      .toMatchObject({ mode: "designated", designatedUserId: SOLO, revision: 1, outcome: "applied", pending: null });
    const requests = await engine.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.couple_change_notifications WHERE tool_name = 'hall_inquiry_approver' AND event_kind = 'approval_requested'");
    expect(requests.rows[0].n).toBe("0");
  });

  it("only the other member answers a proposal, and only the proposal they saw", async () => {
    await setApprover(GROOM, "both");
    const first = await setApprover(BRIDE, "unset");
    await expect(respond(BRIDE, first.pending?.proposalId, true)).rejects.toThrow(/HALL_INQUIRY_APPROVER_PROPOSAL_OWN/);
    await expect(service("SELECT public.hall_inquiry_respond_approver($1, $2, $3, true)", [COUPLE, OUTSIDER, first.pending?.proposalId]))
      .rejects.toThrow(/HALL_INQUIRY_NOT_COUPLE_MEMBER/);
    // 신부가 제안을 바꾸면 앞 제안의 번호로는 답할 수 없고, 앞 확인 요청은 낡은 알림이 된다.
    const second = await setApprover(BRIDE, "designated", BRIDE);
    expect(second.pending?.proposalId).not.toBe(first.pending?.proposalId);
    await expect(respond(GROOM, first.pending?.proposalId, true)).rejects.toThrow(/HALL_INQUIRY_APPROVER_PROPOSAL_CHANGED/);
    const old = await engine.query<{ event_kind: string }>(
      "SELECT event_kind FROM public.couple_change_notifications WHERE action_id = $1", [first.pending?.proposalId]);
    expect(old.rows.map((row) => row.event_kind)).toEqual(["change_stale"]);
    // 제안한 사람이 지금 방식을 다시 고르면 제안을 거둔다.
    expect(await setApprover(BRIDE, "both")).toMatchObject({ mode: "both", outcome: "withdrawn", pending: null });
    await expect(respond(GROOM, second.pending?.proposalId, false)).rejects.toThrow(/HALL_INQUIRY_APPROVER_PROPOSAL_CHANGED/);
  });

  it("approvals given while sending was off never turn into a dispatch when someone presses again after the switch flips", async () => {
    await pick(hallA);
    await pick(hallB);
    await setApprover(GROOM, "both");
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    await approve(BRIDE, draft.versionId, draft.fingerprint, false);
    expect(await approve(GROOM, draft.versionId, draft.fingerprint, false))
      .toMatchObject({ status: "approved_not_queued", notQueuedReason: "sending_disabled" });
    // 켜진 뒤 한 사람이 다시 눌러도 다른 사람의 꺼진 동안 승인은 세지 않는다.
    expect(await approve(GROOM, draft.versionId, draft.fingerprint, true))
      .toMatchObject({ status: "awaiting_approval", waitingFor: [BRIDE], queuedCount: 0 });
    expect(await count("hall_inquiry_dispatches")).toBe(0);
    expect(await approve(BRIDE, draft.versionId, draft.fingerprint, true)).toMatchObject({ status: "queued", queuedCount: 1 });

    // 정한 사람이 꺼진 동안 승인했으면, 켜진 뒤 다른 사람이 눌러도 대기열에 들어가지 않는다.
    const toGroom = await setApprover(BRIDE, "designated", GROOM);
    await respond(GROOM, toGroom.pending?.proposalId, true);
    const next = await save(BRIDE, [hallB], "다른 홀에도 묻고 싶습니다.");
    await approve(GROOM, next.versionId, next.fingerprint, false);
    expect(await approve(BRIDE, next.versionId, next.fingerprint, true))
      .toMatchObject({ status: "awaiting_approval", waitingFor: [GROOM], queuedCount: 0 });
    expect(await count("hall_inquiry_dispatches")).toBe(1);
  });

  it("holds letters back once the service-wide daily cap is reached", async () => {
    await pick(hallA);
    await pick(hallC, OTHER_COUPLE, OUTSIDER);
    const ours = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    expect(await approve(BRIDE, ours.versionId, ours.fingerprint, true, 5, 1)).toMatchObject({ status: "queued", queuedCount: 1 });
    const theirs = (await service<{ value: { versionId: string; fingerprint: string } }>(
      "SELECT public.hall_inquiry_save_letter_version($1, $2, NULL, $3::uuid[], '다른 커플 편지', '다른 사람 드림', $4::jsonb) AS value",
      [OTHER_COUPLE, OUTSIDER, [hallC], JSON.stringify(shares())])).rows[0].value;
    const approveTheirs = async (globalCap: number) => (await service<{ value: ApproveResult }>(
      "SELECT public.hall_inquiry_approve_letter($1, $2, $3, $4, true, 5, $5) AS value",
      [OTHER_COUPLE, OUTSIDER, theirs.versionId, theirs.fingerprint, globalCap])).rows[0].value;
    expect(await approveTheirs(1)).toMatchObject({ status: "approved_not_queued", notQueuedReason: "global_daily_cap", queuedCount: 0 });
    expect((await approveTheirs(0)).notQueuedReason).toBe("global_daily_cap");
    expect(await count("hall_inquiry_dispatches")).toBe(1);
    expect(await approveTheirs(2)).toMatchObject({ status: "queued", queuedCount: 1 });
    await expect(approveTheirs(-1)).rejects.toThrow(/HALL_INQUIRY_INPUT_INVALID/);
  });

  it("caps each couple's shortlist at ten in the database, not only in the route", async () => {
    expect(MAX_SHORTLIST).toBe(10);
    expect(SQL).toMatch(/WHERE pick\.couple_id = NEW\.couple_id\) >= 10 THEN/);
    const extra: string[] = [];
    for (let index = 0; index < 8; index += 1) extra.push(await addListing(`추가 홀 ${index}`));
    for (const hall of [hallA, hallB, ...extra]) await pick(hall);
    await expect(pick(hallC)).rejects.toThrow(/HALL_SHORTLIST_FULL/);
    // 이미 담긴 홀을 다시 담는 것은 상한이 아니라 기본 키가 막는다.
    await expect(pick(hallA)).rejects.toThrow(/duplicate key/);
    await expect(service("INSERT INTO public.hall_shortlists (couple_id, hall_id) VALUES ($1, $2)", [COUPLE, hallC]))
      .rejects.toThrow(/HALL_SHORTLIST_FULL/);
    await engine.asRole("authenticated", BRIDE, "DELETE FROM public.hall_shortlists WHERE couple_id = $1 AND hall_id = $2", [COUPLE, hallA]);
    await pick(hallC);
    expect(await count("hall_shortlists")).toBe(MAX_SHORTLIST);
  });

  it("a deletion parked for manual review stops only the leaving member, and the scrub runs again when it resumes", async () => {
    await pick(hallA);
    await engine.query("INSERT INTO public.account_deletion_jobs (user_id, reason) VALUES ($1, 'privacy')", [GROOM]);
    await expect(save(BRIDE, [hallA], "기다리는 동안 쓰는 편지")).rejects.toThrow(/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/);
    // 사람 검토로 멈추면 남은 사람은 다시 쓸 수 있다. 탈퇴를 신청한 사람은 그대로 막힌다.
    await engine.query(
      "UPDATE public.account_deletion_jobs SET status = 'manual_review', last_error_code = 'unproven_legacy_media' WHERE user_id = $1",
      [GROOM]);
    const written = await save(BRIDE, [hallA], "검토를 기다리는 동안 쓴 편지");
    expect(written.created).toBe(true);
    await expect(save(GROOM, [hallA], "떠나는 사람의 남은 로그인")).rejects.toThrow(/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/);
    // 작업이 다시 돌면 커플을 다시 멈추고, 그사이 쓴 편지도 지운다.
    await engine.query(
      "UPDATE public.account_deletion_jobs SET status = 'inventorying', last_error_code = NULL WHERE user_id = $1", [GROOM]);
    await expect(save(BRIDE, [hallA], "다시 멈춘 뒤")).rejects.toThrow(/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/);
    const body = await engine.query<{ body: string | null }>(
      "SELECT body FROM public.hall_inquiry_letter_versions WHERE id = $1", [written.versionId]);
    expect(body.rows).toEqual([{ body: null }]);
  });

  it("treats exactly the worker states of account deletion as in progress", () => {
    const saga = readMigration("20260716113000_account_deletion_storage_saga.sql");
    const quoted = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    const statuses = quoted(extract(saga, /CONSTRAINT account_deletion_jobs_status\s+CHECK \(status IN \([\s\S]*?\)\)/, "status check"));
    const inProgress = quoted(extract(SQL, /job\.status IN \([^)]*\)/, "in-progress list"));
    expect(inProgress).toEqual(["inventorying", "inventory_ready", "deleting", "auth_deleting"]);
    expect([...statuses].sort()).toEqual([...inProgress, "manual_review", "completed"].sort());
    // 뒤 마이그레이션이 상태 목록을 바꾸면 이 목록도 다시 정해야 한다.
    for (const file of readdirSync(MIGRATIONS).filter((name) => name > "20260716113000_account_deletion_storage_saga.sql" && name.endsWith(".sql"))) {
      expect(readMigration(file), file).not.toMatch(/account_deletion_jobs_status/);
    }
  });

  it("hides operator ids and notes from members reading the tables directly", async () => {
    await pick(hallA);
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.");
    await approve(BRIDE, draft.versionId, draft.fingerprint);
    const dispatch = (await engine.query<{ id: string }>("SELECT id FROM public.hall_inquiry_dispatches")).rows[0].id;
    await service("SELECT public.hall_inquiry_mark_sent($1, $2, '공식 문의 폼')", [dispatch, OPERATOR]);
    await service("SELECT public.hall_inquiry_record_reply($1, $2, '답장 원문', 'question', NULL, NULL, NULL)", [dispatch, OPERATOR]);
    for (const [table, column] of HIDDEN_FROM_MEMBERS) {
      await expect(engine.asRole("authenticated", GROOM, `SELECT ${column} FROM public.${table}`), `${table}.${column}`)
        .rejects.toThrow(/permission denied/);
    }
    await expect(engine.asRole("authenticated", GROOM, "SELECT * FROM public.hall_inquiry_dispatches")).rejects.toThrow(/permission denied/);
    const visible = await engine.asRole<{ status: string }>("authenticated", GROOM, "SELECT id, status, sent_at FROM public.hall_inquiry_dispatches");
    expect(visible.rows.map((row) => row.status)).toEqual(["sent"]);
    const reply = await engine.asRole<{ outcome: string; raw_text: string }>("authenticated", GROOM, "SELECT outcome, raw_text FROM public.hall_inquiry_replies");
    expect(reply.rows).toEqual([{ outcome: "question", raw_text: "답장 원문" }]);
    const outsider = await engine.asRole<{ id: string }>("authenticated", OUTSIDER, "SELECT id FROM public.hall_inquiry_dispatches");
    expect(outsider.rows).toEqual([]);
  });

  it("lets members read their own couple's letters and replies and hides them from other couples", async () => {
    await pick(hallA);
    const draft = await save(BRIDE, [hallA], "상담받고 싶습니다.", shares({ phone: { on: true, value: "010-1234-5678" } }));
    await approve(BRIDE, draft.versionId, draft.fingerprint);
    for (const table of ["hall_inquiry_letters", "hall_inquiry_letter_versions", "hall_inquiry_approvals", "hall_inquiry_dispatches"]) {
      const own = await engine.asRole<{ n: string }>("authenticated", GROOM, `SELECT count(*)::text AS n FROM public.${table}`);
      expect(Number(own.rows[0].n), table).toBeGreaterThan(0);
      const other = await engine.asRole<{ n: string }>("authenticated", OUTSIDER, `SELECT count(*)::text AS n FROM public.${table}`);
      expect(Number(other.rows[0].n), table).toBe(0);
    }
  });
});
