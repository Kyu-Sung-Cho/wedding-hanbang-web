// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// 조율 초안을 사람이 보내는 경로의 DB 쪽. 아직 아무도 호출하지 않지만, 배포 때
// 처음 돌려보는 일이 없도록 여기서 실제로 실행한다.

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260807090000_amora_mediation_send_gate.sql"),
  "utf8",
);

const COUPLE = "10000000-0000-4000-8000-000000000001";
const BRIDE = "00000000-0000-4000-8000-000000000001";
const GROOM = "00000000-0000-4000-8000-000000000002";
const STRANGER = "00000000-0000-4000-8000-000000000009";

/** 초안 산문. 공유된 카드에 이 문장이 섞이면 안 된다. */
const DRAFT_PROSE = "초안에만 있는 산문 문장입니다";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid,
      sender_type text,
      role text,
      content text NOT NULL,
      metadata jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- 확인 RPC는 이 테스트의 대상이 아니다. 호출됐다는 사실만 기록한다.
    CREATE TABLE public.acceptance_calls (message_id uuid, user_id uuid);
    CREATE FUNCTION public.accept_amora_mediation(
      p_couple_id uuid, p_message_id uuid, p_user_id uuid, p_title text,
      p_resolution text, p_expected_proposal_version uuid,
      p_expected_roster_fingerprint text
    ) RETURNS jsonb LANGUAGE plpgsql AS $stub$
    BEGIN
      INSERT INTO public.acceptance_calls VALUES (p_message_id, p_user_id);
      RETURN jsonb_build_object('accepted', true);
    END $stub$;
  `);
  await db.exec(migration);
  await db.exec(`
    INSERT INTO public.couples (id, bride_id, groom_id)
    VALUES ('${COUPLE}', '${BRIDE}', '${GROOM}');
  `);
  return db;
}

function fingerprintSql(bride: string | null, groom: string | null) {
  return `md5('${bride ?? "-"}' || ':' || '${groom ?? "-"}')`;
}

async function insertDraft(
  db: PGlite,
  overrides: { lane?: string; sendable?: boolean; fingerprintOf?: [string | null, string | null] } = {},
) {
  const lane = overrides.lane ?? "bride_private";
  const sendable = overrides.sendable ?? true;
  const [b, g] = overrides.fingerprintOf ?? [BRIDE, GROOM];
  const rows = await db.query<{ id: string }>(`
    INSERT INTO public.chat_messages (couple_id, sender_type, role, content, metadata, visibility)
    VALUES (
      '${COUPLE}', 'ai', 'assistant', '${DRAFT_PROSE}',
      jsonb_build_object(
        'mediation_draft_state', 'draft',
        'mediation_draft_sendable', ${sendable ? "'true'" : "'false'"},
        'mediation_draft_roster_fingerprint', ${fingerprintSql(b, g)},
        'question_scope', 'W1_wedding_adjacent',
        'mediation', jsonb_build_object(
          'empathy', '두 분 다 서운하셨겠어요.',
          'translation', '요청자는 예산을 먼저 정하고 싶다고 전했어요.',
          'data', '지금 확인된 예산 항목은 예식장뿐이에요.',
          'resolution', '이번 주에 각자 상한을 적어 와서 맞춰보시면 어떨까요?'
        )
      ),
      '${lane}'
    ) RETURNING id;
  `);
  return rows.rows[0].id;
}

describe("조율 초안 발송·폐기 RPC", () => {
  it("요청자 레인의 초안을 공유 카드로 보낸다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db);

    const result = await db.query<{ share: { shared_message_id: string; reused: boolean } }>(
      `SELECT public.share_amora_mediation_draft('${draft}', '${BRIDE}', false) AS share;`,
    );
    const sharedId = result.rows[0].share.shared_message_id;
    expect(result.rows[0].share.reused).toBe(false);

    const shared = await db.query<{ content: string; visibility: string; metadata: Record<string, unknown> }>(
      `SELECT content, visibility, metadata FROM public.chat_messages WHERE id = '${sharedId}';`,
    );
    expect(shared.rows[0].visibility).toBe("shared");
    // 본문은 서버 상수. 초안 산문이 한 글자도 섞이지 않는다.
    expect(shared.rows[0].content).toBe("요청하신 분이 초안을 읽고 이 카드를 보냈어요.");
    expect(JSON.stringify(shared.rows[0])).not.toContain(DRAFT_PROSE);
    expect(shared.rows[0].metadata.mediation_source_draft_id).toBe(draft);
    await db.close();
  });

  it("두 번 눌러도 카드는 하나다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db);

    const first = await db.query<{ share: { shared_message_id: string } }>(
      `SELECT public.share_amora_mediation_draft('${draft}', '${BRIDE}', false) AS share;`,
    );
    const second = await db.query<{ share: { shared_message_id: string; reused: boolean } }>(
      `SELECT public.share_amora_mediation_draft('${draft}', '${BRIDE}', false) AS share;`,
    );

    expect(second.rows[0].share.reused).toBe(true);
    expect(second.rows[0].share.shared_message_id).toBe(first.rows[0].share.shared_message_id);

    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.chat_messages WHERE visibility = 'shared';`,
    );
    expect(count.rows[0].n).toBe(1);
    await db.close();
  });

  it("남의 레인 초안은 보낼 수 없다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db, { lane: "bride_private" });

    // 신랑이 신부 레인의 초안을 보내려는 시도.
    await expect(
      db.query(`SELECT public.share_amora_mediation_draft('${draft}', '${GROOM}', false);`),
    ).rejects.toThrow(/AMORA_MEDIATION_DRAFT_NOT_SENDABLE/);
    // 커플 밖 사람도 마찬가지.
    await expect(
      db.query(`SELECT public.share_amora_mediation_draft('${draft}', '${STRANGER}', false);`),
    ).rejects.toThrow(/AMORA_MEDIATION_DRAFT_NOT_SENDABLE/);
    await db.close();
  });

  it("보낼 수 없다고 표시된 초안은 보내지지 않는다", async () => {
    // 안전 사유로 고위험 판정된 턴은 서버가 sendable=false로 찍는다.
    const db = await createDatabase();
    const draft = await insertDraft(db, { sendable: false });

    await expect(
      db.query(`SELECT public.share_amora_mediation_draft('${draft}', '${BRIDE}', false);`),
    ).rejects.toThrow(/AMORA_MEDIATION_DRAFT_NOT_SENDABLE/);
    await db.close();
  });

  it("초안을 만든 뒤 커플 구성이 바뀌면 보내지 않는다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db, { fingerprintOf: [BRIDE, null] });

    await expect(
      db.query(`SELECT public.share_amora_mediation_draft('${draft}', '${BRIDE}', false);`),
    ).rejects.toThrow(/AMORA_MEDIATION_DRAFT_ROSTER_CHANGED/);
    await db.close();
  });

  it("보내면서 요청자 확인까지 한 번에 끝낸다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db);

    await db.query(`SELECT public.share_amora_mediation_draft('${draft}', '${BRIDE}', true);`);

    const calls = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.acceptance_calls WHERE user_id = '${BRIDE}';`,
    );
    expect(calls.rows[0].n).toBe(1);
    await db.close();
  });

  it("폐기하면 행이 남지 않는다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db);

    const result = await db.query<{ discarded: boolean }>(
      `SELECT public.discard_amora_mediation_draft('${draft}', '${BRIDE}') AS discarded;`,
    );
    expect(result.rows[0].discarded).toBe(true);

    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.chat_messages WHERE id = '${draft}';`,
    );
    // "이 초안을 지우면 남지 않아요"가 화면 문구라면, 실제로 0행이어야 한다.
    expect(rows.rows[0].n).toBe(0);
    await db.close();
  });

  it("이미 보낸 초안은 폐기할 수 없다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db);
    await db.query(`SELECT public.share_amora_mediation_draft('${draft}', '${BRIDE}', false);`);

    // 상대가 이미 읽었을 수 있다. 안 보낸 것처럼 만들 수는 없다.
    await expect(
      db.query(`SELECT public.discard_amora_mediation_draft('${draft}', '${BRIDE}');`),
    ).rejects.toThrow(/AMORA_MEDIATION_DRAFT_NOT_DISCARDABLE/);
    await db.close();
  });

  it("남의 초안은 폐기할 수 없다", async () => {
    const db = await createDatabase();
    const draft = await insertDraft(db, { lane: "bride_private" });

    await expect(
      db.query(`SELECT public.discard_amora_mediation_draft('${draft}', '${GROOM}');`),
    ).rejects.toThrow(/AMORA_MEDIATION_DRAFT_NOT_DISCARDABLE/);
    await db.close();
  });

  it("두 함수 모두 service_role 전용이다", async () => {
    const db = await createDatabase();
    const grants = await db.query<{ fn: string; grantee: string }>(`
      SELECT p.proname AS fn, a.grantee
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(p.proacl) AS x
        JOIN pg_roles r ON r.oid = x.grantee
        CROSS JOIN LATERAL (SELECT r.rolname AS grantee) a
       WHERE n.nspname = 'public'
         AND p.proname IN ('share_amora_mediation_draft', 'discard_amora_mediation_draft');
    `);
    const grantees = new Set(grants.rows.map((row) => row.grantee));
    expect(grantees.has("anon")).toBe(false);
    expect(grantees.has("authenticated")).toBe(false);
    expect(grantees.has("service_role")).toBe(true);
    await db.close();
  });
});
