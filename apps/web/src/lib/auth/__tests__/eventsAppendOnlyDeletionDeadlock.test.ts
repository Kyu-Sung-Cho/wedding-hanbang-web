// @vitest-environment node

/**
 * `public.events`의 append-only 트리거와 `ON DELETE SET NULL` FK가 서로를 막는다.
 *
 * `20260718190000_price_consumer_contract.sql`은 한 파일 안에서 두 가지를 함께 넣는다.
 *
 *   ADD COLUMN user_id   uuid REFERENCES auth.users(id)      ON DELETE SET NULL
 *   ADD COLUMN agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL
 *   CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ... reject_event_mutation()
 *
 * FK의 SET NULL은 내부적으로 UPDATE다. 그래서 부모 행을 지우면 BEFORE UPDATE 트리거가
 * `EVENTS_ARE_APPEND_ONLY`를 던지고 **부모 DELETE 트랜잭션 전체가 롤백된다.**
 * 두 컬럼의 상호작용을 설명하는 주석은 마이그레이션에 한 줄도 없다 — 설계가 아니라 누락으로 보인다.
 *
 * 실제 영향
 * - 로그인 상태로 가격 화면을 본 사용자는 `events.user_id`가 채워지므로 탈퇴가 실패한다.
 *   탈퇴 워커의 `auth_delete_failed`는 MANUAL_REVIEW_CODES에 없어 수동 검토로 승격되지 않고
 *   무한 재시도하며, 그동안 storage write fence가 그 사용자의 업로드를 계속 막는다.
 *   사용자는 탈퇴도 못 하고 서비스도 못 쓰는데 운영자에게는 신호가 뜨지 않는다.
 * - 같은 트리거가 BEFORE DELETE도 잡으므로 보유기간 만료 파기(`DELETE FROM public.events`)도
 *   DB 수준에서 실행할 수 없다. 방침 제3조가 약속한 "보유기간 확정"은 이 테이블에 대해
 *   확정해도 집행 수단이 없다.
 *
 * 이 파일의 성격 — **알려진 결함을 고정하는 tripwire다.**
 * 기존 계약 테스트(`accountDeletionIntegrityMigration.test.ts`)는 손으로 만든 FK 픽스처 위에서
 * 돌고 그 픽스처에 `public.events`가 없어서, 이 결함이 지금 어떤 검사에도 걸리지 않는다.
 * 그래서 "고쳐진 상태"를 단언해 CI를 빨갛게 만드는 대신, **현재의 깨진 계약을 그대로 못박는다.**
 * 트리거나 FK를 고치면 이 테스트가 실패한다. 그때 이 주석을 읽고 파일을 지우거나
 * 단언을 뒤집으면 된다. 그것이 이 파일의 목적이다.
 *
 * 고치는 방향은 둘 중 하나다.
 *   (a) `reject_event_mutation()`이 FK 주도의 `user_id`/`agency_id` → NULL UPDATE만 통과시킨다.
 *   (b) 두 컬럼을 FK로 두지 않고, 삭제 워커가 명시적으로 연결을 끊는다.
 * 어느 쪽이든 운영 DB 스키마 변경이므로 승인된 release manifest 절차가 필요하다.
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

/** 마이그레이션 원문에서 문장을 그대로 꺼낸다. 손으로 옮겨 적으면 원본이 바뀌어도 눈치채지 못한다. */
function statement(pattern: RegExp, label: string): string {
  const match = priceConsumerMigration.match(pattern);
  if (!match) {
    throw new Error(
      `마이그레이션에서 '${label}' 문장을 찾지 못했다. ` +
        "원문이 바뀌었다면 이 테스트가 고정하려는 계약도 함께 확인해야 한다.",
    );
  }
  return match[0];
}

const eventsColumns = statement(
  /ALTER TABLE public\.events\n\s+ADD COLUMN IF NOT EXISTS user_id[\s\S]*?weight integer NOT NULL DEFAULT 0;/,
  "events 컬럼 추가(user_id·agency_id FK 포함)",
);

const rejectMutationFunction = statement(
  /CREATE OR REPLACE FUNCTION public\.reject_event_mutation\(\)[\s\S]*?\$reject_event_mutation\$;/,
  "reject_event_mutation()",
);

const appendOnlyTrigger = statement(
  /CREATE TRIGGER events_append_only[\s\S]*?EXECUTE FUNCTION public\.reject_event_mutation\(\);/,
  "events_append_only 트리거",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AGENCY_ID = "33333333-3333-4333-8333-333333333333";

async function createEventsDatabase() {
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
  await db.exec(rejectMutationFunction);
  await db.exec(appendOnlyTrigger);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_ID}');
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

describe("public.events append-only 트리거와 SET NULL FK의 교착 (알려진 결함)", () => {
  it("user_id가 채워진 이벤트가 있으면 계정 삭제 전체가 롤백된다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-signed-in", userId: USER_ID });

    await expectAppendOnlyRejection(() =>
      db.exec(`DELETE FROM auth.users WHERE id = '${USER_ID}';`),
    );

    // 롤백이므로 사용자 행과 이벤트 행이 둘 다 남는다 — 부분 삭제조차 일어나지 않는다.
    const users = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM auth.users",
    );
    const events = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.events",
    );
    expect(users.rows[0].count).toBe(1);
    expect(events.rows[0].count).toBe(1);
  });

  it("agency_id도 같은 구조라 대행사 삭제가 막힌다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-agency", agencyId: AGENCY_ID });

    await expectAppendOnlyRejection(() =>
      db.exec(`DELETE FROM public.agencies WHERE id = '${AGENCY_ID}';`),
    );

    const agencies = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.agencies",
    );
    expect(agencies.rows[0].count).toBe(1);
  });

  it("연결된 이벤트가 없으면 삭제가 성공한다 — 트리거 자체가 아니라 FK 조합이 원인이다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-anonymous" });

    await db.exec(`DELETE FROM auth.users WHERE id = '${USER_ID}';`);

    const users = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM auth.users",
    );
    expect(users.rows[0].count).toBe(0);
  });

  it("보유기간 만료 파기도 같은 트리거에 막힌다", async () => {
    const db = await createEventsDatabase();
    await insertEvent(db, { anonId: "anon-old", userId: USER_ID });

    await expectAppendOnlyRejection(() =>
      db.exec("DELETE FROM public.events WHERE created_at < now();"),
    );
  });

  it("두 FK가 모두 SET NULL이라는 사실을 마이그레이션 원문에서 확인한다", () => {
    expect(eventsColumns).toContain(
      "user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL",
    );
    expect(eventsColumns).toContain(
      "agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL",
    );
    // 트리거가 UPDATE와 DELETE를 모두 잡기 때문에 위 SET NULL이 성립할 수 없다.
    expect(appendOnlyTrigger).toContain("BEFORE UPDATE OR DELETE");
  });
});
