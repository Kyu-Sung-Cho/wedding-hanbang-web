// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

// 이 라벨은 couple_plan_change_requests.summary 에 저장되고 알림 문구로 복사된다.
// 저장 경로라 나중에 고쳐도 이미 저장된 행은 안 고쳐진다 — 그래서 여기서 막는다.

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260820140000_neutral_schedule_assignee_label.sql",
  ),
  "utf8",
);

const BRIDE_ID = "20000000-0000-4000-8000-000000000001";
const GROOM_ID = "30000000-0000-4000-8000-000000000001";
const V1_COUPLE = "10000000-0000-4000-8000-000000000001";
const V2_COUPLE = "10000000-0000-4000-8000-000000000002";
const V2_A = "20000000-0000-4000-8000-000000000002";
const V2_B = "30000000-0000-4000-8000-000000000002";

const databases: PGlite[] = [];

async function createDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid,
      member_model_version integer NOT NULL DEFAULT 1
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      name text
    );
    INSERT INTO public.profiles(id, name) VALUES
      ('${BRIDE_ID}', '김신부'), ('${GROOM_ID}', '박신랑'),
      ('${V2_A}', '김규성'), ('${V2_B}', NULL);
    INSERT INTO public.couples(id, bride_id, groom_id, member_model_version) VALUES
      ('${V1_COUPLE}', '${BRIDE_ID}', '${GROOM_ID}', 1),
      ('${V2_COUPLE}', '${V2_A}', '${V2_B}', 2);
  `);
  await db.exec(migration);
  return db;
}

async function label(db: PGlite, profileId: string, brideId: string, groomId: string) {
  const result = await db.query<{ label: string }>(`
    SELECT public.amora_manual_schedule_assignee_label(
      jsonb_build_object('kind', 'member', 'profileId', '${profileId}'),
      '${brideId}'::uuid, '${groomId}'::uuid
    ) AS label
  `);
  return result.rows[0]?.label;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("일정 담당자 라벨", () => {
  it("기존(v1) 커플은 그대로 예비 신부/신랑이다", async () => {
    const db = await createDatabase();
    expect(await label(db, BRIDE_ID, BRIDE_ID, GROOM_ID)).toBe("예비 신부");
    expect(await label(db, GROOM_ID, BRIDE_ID, GROOM_ID)).toBe("예비 신랑");
  });

  it("중립(v2) 커플은 성별 대신 이름을 쓴다", async () => {
    const db = await createDatabase();
    expect(await label(db, V2_A, V2_A, V2_B)).toBe("김규성");
  });

  it("이름이 없어도 성별로 되돌아가지 않고 두 사람을 구분한다", async () => {
    const db = await createDatabase();
    const result = await label(db, V2_B, V2_A, V2_B);
    expect(result).toBe("구성원 2");
    expect(result).not.toContain("신부");
    expect(result).not.toContain("신랑");
  });

  it("커플·외부 담당자는 바뀌지 않는다", async () => {
    const db = await createDatabase();
    const couple = await db.query<{ label: string }>(`
      SELECT public.amora_manual_schedule_assignee_label(
        '{"kind":"couple"}'::jsonb, '${V2_A}'::uuid, '${V2_B}'::uuid
      ) AS label
    `);
    expect(couple.rows[0]?.label).toBe("함께");
  });
});
