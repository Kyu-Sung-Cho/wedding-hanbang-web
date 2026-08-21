// @vitest-environment node

/**
 * `public.events`의 append-only 트리거와 `ON DELETE SET NULL` FK가 서로를 막던 문제.
 *
 * `20260718190000_price_consumer_contract.sql`은 한 파일 안에서 두 가지를 함께 넣었다.
 *
 *   ADD COLUMN user_id   uuid REFERENCES auth.users(id)      ON DELETE SET NULL
 *   ADD COLUMN agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL
 *   CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ... reject_event_mutation()
 *
 * FK의 SET NULL은 내부적으로 UPDATE다. 그래서 부모 행을 지우면 BEFORE UPDATE 트리거가
 * `EVENTS_ARE_APPEND_ONLY`를 던지고 **부모 DELETE 트랜잭션 전체가 롤백됐다.**
 * 로그인 상태로 가격 화면을 한 번이라도 본 사용자는 탈퇴가 실패했고, 워커의
 * `auth_delete_failed`는 MANUAL_REVIEW_CODES에 없어 수동 검토로 올라가지도 않은 채
 * 무한 재시도했다. 그동안 storage write fence가 그 사용자의 업로드를 계속 막았다.
 *
 * 이 파일은 원래 **그 깨진 계약을 그대로 못박는 tripwire**였다.
 * `20260821120000_events_append_only_allows_fk_detach.sql`이 그것을 고쳤으므로,
 * 파일 주석이 지시한 대로 단언을 뒤집는다 — 이제 고쳐진 계약을 고정한다.
 *
 * 지키는 것:
 *   - 부모 삭제로 인한 user_id/agency_id → NULL UPDATE만 통과한다.
 *   - 다른 컬럼을 함께 바꾸면 여전히 거부한다.
 *   - 값을 다른 사용자로 바꿔치기하는 UPDATE도 거부한다.
 *   - DELETE·TRUNCATE는 그대로 막힌다(감사 기록의 성격을 바꾸지 않는다).
 *     탈퇴 뒤에는 user_id가 NULL이라 그 행이 개인을 가리키지 않는다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const priceConsumerMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718190000_price_consumer_contract.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/** 고친 쪽. 손으로 옮겨 적으면 원본이 바뀌어도 눈치채지 못한다. */
const detachFixMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260821120000_events_append_only_allows_fk_detach.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/** 마이그레이션 원문에서 문장을 그대로 꺼낸다. */
function statement(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(
      `마이그레이션에서 '${label}' 문장을 찾지 못했다. ` +
        "원문이 바뀌었다면 이 테스트가 고정하려는 계약도 함께 확인해야 한다.",
    );
  }
  return match[0];
}

const eventsColumns = statement(
  priceConsumerMigration,
  /ALTER TABLE public\.events\n\s+ADD COLUMN IF NOT EXISTS user_id[\s\S]*?weight integer NOT NULL DEFAULT 0;/,
  "events 컬럼 추가(user_id·agency_id FK 포함)",
);

const originalRejectMutation = statement(
  priceConsumerMigration,
  /CREATE OR REPLACE FUNCTION public\.reject_event_mutation\(\)[\s\S]*?\$reject_event_mutation\$;/,
  "원래 reject_event_mutation()",
);

const fixedRejectMutation = statement(
  detachFixMigration,
  /CREATE OR REPLACE FUNCTION public\.reject_event_mutation\(\)[\s\S]*?\$reject_event_mutation\$;/,
  "고친 reject_event_mutation()",
);

const appendOnlyTrigger = statement(
  priceConsumerMigration,
  /CREATE TRIGGER events_append_only[\s\S]*?EXECUTE FUNCTION public\.reject_event_mutation\(\);/,
  "events_append_only 트리거",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const AGENCY_ID = "33333333-3333-4333-8333-333333333333";

/** applyFix=false 면 고치기 전 상태를 그대로 세운다(대조군). */
async function createEventsDatabase(applyFix = true) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.agencies (id uuid PRIMARY KEY);
    CREATE TABLE public.events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      anon_id text NOT NULL,
      vendor_id uuid,
      surface text NOT NULL,
      event_type text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.exec(eventsColumns);
  await db.exec(originalRejectMutation);
  await db.exec(appendOnlyTrigger);
  if (applyFix) await db.exec(fixedRejectMutation);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_ID}'), ('${OTHER_USER_ID}');
    INSERT INTO public.agencies (id) VALUES ('${AGENCY_ID}');
  `);
  return db;
}

async function insertEvent(
  db: PGlite,
  columns: { anonId: string; userId?: string; agencyId?: string },
) {
  await db.exec(`
    INSERT INTO public.events (anon_id, surface, event_type, user_id, agency_id)
    VALUES (
      '${columns.anonId}',
      'price_list',
      'page_view',
      ${columns.userId ? `'${columns.userId}'` : "NULL"},
      ${columns.agencyId ? `'${columns.agencyId}'` : "NULL"}
    );
  `);
}

async function expectAppendOnlyRejection(run: () => Promise<unknown>) {
  let message: string | null = null;
  try {
    await run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).not.toBeNull();
  expect(message).toContain("EVENTS_ARE_APPEND_ONLY");
}

async function count(db: PGlite, sql: string) {
  const result = await db.query<{ count: number }>(sql);
  return result.rows[0].count;
}

describe("고치기 전 — 이 결함이 실재했다", () => {
  it("user_id가 채워진 이벤트가 있으면 계정 삭제 전체가 롤백됐다", async () => {
    const db = await createEventsDatabase(false);
    await insertEvent(db, { anonId: "anon-signed-in", userId: USER_ID });

    await expectAppendOnlyRejection(() =>
      db.exec(`DELETE FROM auth.users WHERE id = '${USER_ID}';`),
    );
    expect(await count(db, "SELECT count(*)::int AS count FROM auth.users")).toBe(2);
  });
});

describe("고친 뒤 — 탈퇴가 완료된다", () => {
  it("user_id가 채워진 이벤트가 있어도 계정이 지워지고, 이벤트는 익명으로 남는다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-signed-in", userId: USER_ID });

    await db.exec(`DELETE FROM auth.users WHERE id = '${USER_ID}';`);

    expect(
      await count(db, `SELECT count(*)::int AS count FROM auth.users WHERE id = '${USER_ID}'`),
    ).toBe(0);
    // 행은 남되 개인을 가리키지 않는다.
    expect(await count(db, "SELECT count(*)::int AS count FROM public.events")).toBe(1);
    expect(
      await count(db, "SELECT count(*)::int AS count FROM public.events WHERE user_id IS NULL"),
    ).toBe(1);
  });

  it("agency_id도 같은 방식으로 끊긴다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-agency", agencyId: AGENCY_ID });

    await db.exec(`DELETE FROM public.agencies WHERE id = '${AGENCY_ID}';`);

    expect(await count(db, "SELECT count(*)::int AS count FROM public.agencies")).toBe(0);
    expect(
      await count(db, "SELECT count(*)::int AS count FROM public.events WHERE agency_id IS NULL"),
    ).toBe(1);
  });

  it("두 FK가 한 행에 함께 걸려 있어도 계정 삭제가 끝난다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-both", userId: USER_ID, agencyId: AGENCY_ID });

    await db.exec(`DELETE FROM auth.users WHERE id = '${USER_ID}';`);

    expect(
      await count(db, "SELECT count(*)::int AS count FROM public.events WHERE user_id IS NULL"),
    ).toBe(1);
    // 대행사 연결은 그대로 남아야 한다 — 지운 것은 사용자뿐이다.
    expect(
      await count(
        db,
        `SELECT count(*)::int AS count FROM public.events WHERE agency_id = '${AGENCY_ID}'`,
      ),
    ).toBe(1);
  });
});

describe("고친 뒤에도 append-only 는 append-only 다", () => {
  it("다른 컬럼을 함께 바꾸는 UPDATE는 거부한다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-tamper", userId: USER_ID });

    await expectAppendOnlyRejection(() =>
      db.exec("UPDATE public.events SET user_id = NULL, event_type = 'tampered';"),
    );
  });

  it("이벤트를 다른 사용자에게 옮겨 붙이는 UPDATE는 거부한다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-move", userId: USER_ID });

    await expectAppendOnlyRejection(() =>
      db.exec(`UPDATE public.events SET user_id = '${OTHER_USER_ID}';`),
    );
  });

  it("메타데이터만 고치는 UPDATE도 거부한다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-meta", userId: USER_ID });

    await expectAppendOnlyRejection(() =>
      db.exec(`UPDATE public.events SET metadata = '{"x":1}'::jsonb;`),
    );
  });

  it("행을 지우는 것은 여전히 막힌다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-old", userId: USER_ID });

    await expectAppendOnlyRejection(() =>
      // `<`가 아니라 `<=`인 이유: `created_at`의 기본값도 `now()`이고 `now()`는 트랜잭션
      // 시작 시각이라, 넣은 트랜잭션과 지우는 트랜잭션이 같은 시각을 받으면 `<`에 걸리는
      // 행이 하나도 없다. 그러면 DELETE가 일어나지 않아 트리거도 안 걸리고, 이 검사는
      // "막혔다"를 기대한 자리에서 아무 오류도 못 받아 실패한다. 2026-08-21에 같은 트리에서
      // 세 번 돌려 한 번 그렇게 실패했다. 이 검사가 보려는 것은 날짜 조건이 아니라
      // **보유기간 파기 모양의 DELETE가 트리거에 막힌다**는 것이라, 조건을 넓혀도 뜻은 같다.
      db.exec("DELETE FROM public.events WHERE created_at <= now();"),
    );
  });

  it("사용자와 무관한 이벤트는 원래도 삭제를 막지 않았다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-anonymous" });

    await db.exec(`DELETE FROM auth.users WHERE id = '${USER_ID}';`);
    expect(
      await count(db, `SELECT count(*)::int AS count FROM auth.users WHERE id = '${USER_ID}'`),
    ).toBe(0);
  });

  it("두 FK가 모두 SET NULL이라는 사실을 마이그레이션 원문에서 확인한다", () => {
    expect(eventsColumns).toContain(
      "user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL",
    );
    expect(eventsColumns).toContain(
      "agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL",
    );
    expect(appendOnlyTrigger).toContain("BEFORE UPDATE OR DELETE");
  });
});
