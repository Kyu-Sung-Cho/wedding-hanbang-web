// @vitest-environment node
//
// 20260812030000 이 초대 코드에 7일 창을 붙인 뒤, 만료된 코드로 합류를 시도하면
// 'INVALID_INVITE_CODE' 가 돌아왔다. 화면은 그걸 "초대 코드가 올바르지 않습니다.
// 코드를 다시 확인해주세요" 로 옮긴다 - 만료를 오타로 바꿔 말한 것이다.
//
// 여기서는 진짜 마이그레이션 두 개를 PGlite 에 올리고, 만료된 초대로 실제 RPC 를
// 호출해서 (1) 만료가 만료라고 불리는지 (2) 그럼에도 합류는 여전히 막히는지
// (3) 없는 코드와 끝난 커플의 코드는 여전히 아무것도 흘리지 않는지 확인한다.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, describe, expect, it } from "vitest";

const hardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812030000_couple_invite_replay_hardening.sql",
  ),
  "utf8",
);
const neutralGuardMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260820130000_legacy_join_blocks_neutral_space.sql",
  ),
  "utf8",
);
const expiryTruthMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260820150000_invite_expiry_is_not_a_typo.sql",
  ),
  "utf8",
);

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const STRANGER_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const SEALED_COUPLE_ID = "10000000-0000-4000-8000-000000000002";
const NEUTRAL_COUPLE_ID = "10000000-0000-4000-8000-000000000003";

const LIVE_CODE = "WH-AAAABBBBCCCC";
const SEALED_CODE = "WH-DDDDEEEEFFFF";
const NEUTRAL_CODE = "WH-111122223333";

const NEWLINE = String.fromCharCode(10);

const databases: PGlite[] = [];

type JoinResult = {
  success?: boolean;
  joined?: boolean;
  error_code?: string;
  error?: string;
  couple_id?: string;
};

/**
 * 하드닝 마이그레이션이 요구하는 최소 전제만 세운다. 실제 스키마를 통째로
 * 재현하지 않는 대신, 마이그레이션 본문은 손대지 않고 그대로 실행한다.
 */
async function createDatabase(options: {
  applyExpiryTruth: boolean;
  applyNeutralGuard?: boolean;
}) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  databases.push(db);

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $uid$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $uid$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bride_id uuid,
      groom_id uuid,
      invite_code text UNIQUE,
      member_model_version smallint NOT NULL DEFAULT 1,
      membership_sealed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id),
      role text CHECK (role IN ('bride', 'groom')),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- 두 사람이 차면 명부를 봉인한다. core 의 사후조건이 이 봉인을 확인한다.
    CREATE FUNCTION public.test_enforce_couple_roster_epoch() RETURNS trigger
    LANGUAGE plpgsql AS $epoch$
    BEGIN
      IF NEW.bride_id IS NOT NULL AND NEW.groom_id IS NOT NULL THEN
        NEW.membership_sealed_at := COALESCE(
          NEW.membership_sealed_at, clock_timestamp());
      END IF;
      RETURN NEW;
    END
    $epoch$;
    CREATE TRIGGER trg_enforce_couple_roster_epoch
      BEFORE INSERT OR UPDATE ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.test_enforce_couple_roster_epoch();

    -- 하드닝 마이그레이션이 SET CONSTRAINTS 로 이 이름을 즉시화한다.
    CREATE FUNCTION public.test_current_couple_row_integrity() RETURNS trigger
    LANGUAGE plpgsql AS $fence$ BEGIN RETURN NULL; END $fence$;
    CREATE CONSTRAINT TRIGGER trg_current_couple_row_integrity
      AFTER INSERT OR UPDATE ON public.couples
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.test_current_couple_row_integrity();

    CREATE FUNCTION public.generate_invite_code() RETURNS text
    LANGUAGE plpgsql
    AS $gen$
    DECLARE v_code text;
    BEGIN
      LOOP
        v_code := 'WH-' || upper(substr(
          replace(gen_random_uuid()::text, '-', ''), 1, 12));
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.couples WHERE invite_code = v_code
        );
      END LOOP;
      RETURN v_code;
    END
    $gen$;

    -- 하드닝의 전제조건이 이 시그니처의 존재만 확인한다. 본문은 곧 교체된다.
    CREATE FUNCTION public.join_couple(p_invite_code text, p_role text)
    RETURNS jsonb LANGUAGE sql AS $stub$ SELECT '{}'::jsonb $stub$;
  `);

  await db.exec(hardeningMigration);
  // 실제 순서대로 올린다: 20260820130000 이 래퍼에 중립공간 가드를 걸고,
  // 20260820150000 은 core 만 교체한다. 순서가 어긋나면 가드가 조용히 사라진다.
  if (options.applyNeutralGuard) await db.exec(neutralGuardMigration);
  if (options.applyExpiryTruth) await db.exec(expiryTruthMigration);

  await db.exec(`
    INSERT INTO public.couples (id, bride_id, invite_code)
    VALUES ('${COUPLE_ID}', '${OWNER_ID}', '${LIVE_CODE}');
    INSERT INTO public.profiles (id, couple_id, role)
    VALUES ('${OWNER_ID}', '${COUPLE_ID}', 'bride');
    INSERT INTO public.profiles (id, couple_id, role) VALUES ('${PARTNER_ID}', NULL, NULL);
    INSERT INTO public.profiles (id, couple_id, role) VALUES ('${STRANGER_ID}', NULL, NULL);
    SET CONSTRAINTS trg_current_couple_row_integrity IMMEDIATE;
  `);

  return db;
}

/**
 * 창을 과거로 민다. 수명 트리거는 서버 소유라 잠시 내려야 하고, 지연 제약
 * 트리거를 먼저 즉시화하지 않으면 ALTER TABLE 이 보류 이벤트에 막힌다.
 */
async function expireInvite(db: PGlite, coupleId: string) {
  await db.exec(`
    SET CONSTRAINTS trg_current_couple_row_integrity IMMEDIATE;
    ALTER TABLE public.couples DISABLE TRIGGER trg_manage_couple_invite_lifecycle;
    UPDATE public.couples
    SET invite_code_issued_at = now() - interval '8 days',
        invite_code_expires_at = now() - interval '1 day'
    WHERE id = '${coupleId}';
    ALTER TABLE public.couples ENABLE TRIGGER trg_manage_couple_invite_lifecycle;
  `);
}

async function joinAsServer(db: PGlite, actor: string, code: string, role: string) {
  const result = await db.query<{ join_couple_server: JoinResult }>(
    "SELECT public.join_couple_server($1::uuid, $2::text, $3::text)",
    [actor, code, role],
  );
  return result.rows[0].join_couple_server;
}

afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

describe("만료된 초대 코드는 오타로 보고되지 않는다", () => {
  it("살아 있는 코드로는 그대로 합류한다 (하네스가 실제로 동작하는지)", async () => {
    const db = await createDatabase({ applyExpiryTruth: true });
    const outcome = await joinAsServer(db, PARTNER_ID, LIVE_CODE, "groom");
    expect(outcome).toMatchObject({ success: true, joined: true, couple_id: COUPLE_ID });
  }, 60_000);

  it("만료된 코드는 INVITE_CODE_EXPIRED 로 돌아온다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true });
    await expireInvite(db, COUPLE_ID);

    const outcome = await joinAsServer(db, PARTNER_ID, LIVE_CODE, "groom");
    expect(outcome.success).toBe(false);
    expect(outcome.error_code).toBe("INVITE_CODE_EXPIRED");
  }, 60_000);

  it("고치기 전에는 같은 상황이 INVALID_INVITE_CODE 였다 (뮤테이션 확인)", async () => {
    const db = await createDatabase({ applyExpiryTruth: false });
    await expireInvite(db, COUPLE_ID);

    const outcome = await joinAsServer(db, PARTNER_ID, LIVE_CODE, "groom");
    expect(outcome.error_code).toBe("INVALID_INVITE_CODE");
  }, 60_000);

  it("인증 경로(join_couple)도 같은 사실을 말한다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true });
    await expireInvite(db, COUPLE_ID);

    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${PARTNER_ID}', false);`);
    const result = await db.query<{ join_couple: JoinResult }>(
      "SELECT public.join_couple($1::text, $2::text)",
      [LIVE_CODE, "groom"],
    );
    expect(result.rows[0].join_couple.error_code).toBe("INVITE_CODE_EXPIRED");
  }, 60_000);
});

describe("말만 바꾸고 문을 열어두지 않는다", () => {
  it("만료된 코드로는 여전히 합류하지 못한다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true });
    await expireInvite(db, COUPLE_ID);

    const outcome = await joinAsServer(db, PARTNER_ID, LIVE_CODE, "groom");
    expect(outcome.joined).toBe(false);

    const couple = await db.query<{ groom_id: string | null; invite_code: string | null }>(
      `SELECT groom_id, invite_code FROM public.couples WHERE id = '${COUPLE_ID}'`,
    );
    expect(couple.rows[0].groom_id).toBeNull();
    expect(couple.rows[0].invite_code).toBe(LIVE_CODE);

    const profile = await db.query<{ couple_id: string | null }>(
      `SELECT couple_id FROM public.profiles WHERE id = '${PARTNER_ID}'`,
    );
    expect(profile.rows[0].couple_id).toBeNull();
  }, 60_000);

  it("없는 코드는 여전히 INVALID_INVITE_CODE 다 - 존재 여부를 흘리지 않는다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true });
    const outcome = await joinAsServer(db, PARTNER_ID, "WH-ZZZZZZZZZZZZ", "groom");
    expect(outcome.error_code).toBe("INVALID_INVITE_CODE");
  }, 60_000);

  it("끝난 커플이 보관 중인 코드는 만료가 아니라 INVALID 로 남는다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true });
    await db.exec(`
      SET CONSTRAINTS trg_current_couple_row_integrity IMMEDIATE;
      ALTER TABLE public.couples DISABLE TRIGGER trg_manage_couple_invite_lifecycle;
      INSERT INTO public.couples
        (id, bride_id, groom_id, invite_code, membership_sealed_at,
         invite_code_issued_at, invite_code_expires_at)
      VALUES ('${SEALED_COUPLE_ID}', '${OWNER_ID}', '${PARTNER_ID}', '${SEALED_CODE}',
              now() - interval '2 days', NULL, NULL);
      ALTER TABLE public.couples ENABLE TRIGGER trg_manage_couple_invite_lifecycle;
    `);

    const outcome = await joinAsServer(db, STRANGER_ID, SEALED_CODE, "groom");
    expect(outcome.error_code).toBe("INVALID_INVITE_CODE");
  }, 60_000);

  it("만료 조회도 레이트리밋 뒤에 있다 - 만료 응답으로 제한을 우회하지 못한다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true });
    await expireInvite(db, COUPLE_ID);

    const codes: string[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      codes.push((await joinAsServer(db, PARTNER_ID, LIVE_CODE, "groom")).error_code ?? "");
    }
    expect(codes.slice(0, 10).every((code) => code === "INVITE_CODE_EXPIRED")).toBe(true);
    expect(codes[10]).toBe("RATE_LIMITED");
  }, 60_000);
});

describe("중립공간 가드와 나란히 올려도 서로를 지우지 않는다", () => {
  it("core 만 교체하므로 래퍼의 v2 가드가 살아남는다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true, applyNeutralGuard: true });
    await db.exec(`
      SET CONSTRAINTS trg_current_couple_row_integrity IMMEDIATE;
      INSERT INTO public.couples (id, bride_id, invite_code, member_model_version)
      VALUES ('${NEUTRAL_COUPLE_ID}', '${OWNER_ID}', '${NEUTRAL_CODE}', 2);
    `);

    const outcome = await joinAsServer(db, PARTNER_ID, NEUTRAL_CODE, "groom");
    expect(outcome.error_code).toBe("NEUTRAL_PREPARATION_SPACE");
  }, 60_000);

  it("가드가 있어도 v1 만료는 만료라고 말한다", async () => {
    const db = await createDatabase({ applyExpiryTruth: true, applyNeutralGuard: true });
    await expireInvite(db, COUPLE_ID);

    const outcome = await joinAsServer(db, PARTNER_ID, LIVE_CODE, "groom");
    expect(outcome.error_code).toBe("INVITE_CODE_EXPIRED");
  }, 60_000);
});

// 가드는 깨뜨려봐야 센다. 아래 두 개는 마이그레이션 본문을 실제로 변조해서
// 사후조건이 정말 막는지 확인한다 - 통과만 보면 초록불의 뜻을 알 수 없다.
describe("사후조건이 실제로 막는다", () => {
  async function applyTampered(transform: (sql: string) => string) {
    const db = await createDatabase({ applyExpiryTruth: false });
    const tampered = transform(expiryTruthMigration);
    expect(tampered).not.toBe(expiryTruthMigration);
    return db.exec(tampered);
  }

  it("최종 UPDATE 에서 창 검사를 하나라도 빼면 적용을 거부한다", async () => {
    await expect(applyTampered((sql) =>
      sql.replace("      AND invite_code_expires_at > v_now\n", ""),
    )).rejects.toThrow(/INVITE_EXPIRY_TRUTH_WINDOW_LOST/);
  }, 60_000);

  it("락 후 재검증을 지우면 적용을 거부한다", async () => {
    const RECHECK = [
      "  IF v_invite_expires_at IS NULL OR v_invite_expires_at <= v_now THEN",
      "    RETURN jsonb_build_object(",
      "      'success', false, 'joined', false, 'idempotent', false,",
      "      'error_code', 'INVITE_CODE_EXPIRED', 'error', 'Invite code expired.'",
      "    );",
      "  END IF;",
    ].join(NEWLINE);

    await expect(applyTampered((sql) => {
      const last = sql.lastIndexOf(RECHECK);
      return sql.slice(0, last) + sql.slice(last + RECHECK.length);
    })).rejects.toThrow(/INVITE_EXPIRY_TRUTH_RECHECK_LOST/);
  }, 60_000);

  it("만료를 말하지 못하는 본문은 적용을 거부한다", async () => {
    await expect(applyTampered((sql) =>
      sql
        .split("'error_code', 'INVITE_CODE_EXPIRED', 'error', 'Invite code expired.'")
        .join("'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'"),
    )).rejects.toThrow(/INVITE_EXPIRY_TRUTH_NOT_APPLIED/);
  }, 60_000);
});
