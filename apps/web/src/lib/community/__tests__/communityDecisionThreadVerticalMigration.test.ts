// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationRoot = resolve(process.cwd(), "../../supabase/migrations");
const runtimeMigration = readFileSync(
  resolve(migrationRoot, "20260804130000_community_runtime_control.sql"),
  "utf8",
);
const responderMigration = readFileSync(
  resolve(
    migrationRoot,
    "20260804140000_community_responder_supply_foundation.sql",
  ),
  "utf8",
);
const viewerMigration = readFileSync(
  resolve(migrationRoot, "20260804180000_community_viewer_controls.sql"),
  "utf8",
);
const decisionMigration = readFileSync(
  resolve(
    migrationRoot,
    "20260804190000_community_decision_thread_vertical.sql",
  ),
  "utf8",
);

const ADMIN = "10000000-0000-4000-8000-000000000001";
const PRIMARY = "10000000-0000-4000-8000-000000000002";
const BACKUP = "10000000-0000-4000-8000-000000000003";
const VIEWER = "10000000-0000-4000-8000-000000000004";
const AUTHOR = "10000000-0000-4000-8000-000000000005";
const QUESTION = "20000000-0000-4000-8000-000000000001";
const PUBLISH_KEY = "30000000-0000-4000-8000-000000000001";

type Receipt = Record<string, unknown>;

type PublicationFixture = {
  actorId: string;
  questionId: string;
  publishKey: string;
};

function responderFixtureBlocks() {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/lib/community/__tests__/communityResponderSupplyMigration.test.ts",
    ),
    "utf8",
  );
  const blocks = Array.from(
    source.matchAll(/await db\.exec\(`([\s\S]*?)`\);/g),
    (match) => match[1],
  );
  if (!blocks[0] || !blocks[1]) {
    throw new Error("authoritative responder PGlite fixture changed shape");
  }
  const replacements: Record<string, string> = {
    ADMIN_ID: ADMIN,
    RESPONDER_ONE: PRIMARY,
    RESPONDER_TWO: BACKUP,
    RESPONDER_THREE: VIEWER,
    OUTSIDER_ID: AUTHOR,
  };
  let base = blocks[0];
  for (const [name, id] of Object.entries(replacements)) {
    base = base.replaceAll(`\${${name}}`, id);
  }
  return { base, viewerDependencies: blocks[1] };
}

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  const fixture = responderFixtureBlocks();
  await db.exec(fixture.base);
  await db.exec(runtimeMigration);
  await db.exec(responderMigration);
  await db.exec(fixture.viewerDependencies);
  await db.exec(viewerMigration);
  await db.exec(`
    CREATE TYPE public.community_content_origin AS ENUM (
      'member', 'industry_professional', 'ai', 'operator', 'vendor',
      'legacy_unverified'
    );
    ALTER TABLE public.community_profiles
      ADD COLUMN post_count integer NOT NULL DEFAULT 0,
      ADD COLUMN comment_count integer NOT NULL DEFAULT 0,
      ADD COLUMN total_upvotes_received integer NOT NULL DEFAULT 0,
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
    ALTER TABLE public.community_posts
      ADD COLUMN category text NOT NULL DEFAULT 'is_normal',
      ADD COLUMN title text NOT NULL DEFAULT 'fixture title',
      ADD COLUMN content text NOT NULL DEFAULT 'fixture body content long enough',
      ADD COLUMN images text[] NOT NULL DEFAULT ARRAY[]::text[],
      ADD COLUMN visibility text NOT NULL DEFAULT 'public',
      ADD COLUMN author_visibility text NOT NULL DEFAULT 'public',
      ADD COLUMN tags text[] NOT NULL DEFAULT ARRAY[]::text[],
      ADD COLUMN ad_disclosure text NOT NULL DEFAULT 'general',
      ADD COLUMN sponsorship_detail text,
      ADD COLUMN is_resolved boolean NOT NULL DEFAULT false,
      ADD COLUMN under_review boolean NOT NULL DEFAULT false,
      ADD COLUMN content_origin public.community_content_origin
        NOT NULL DEFAULT 'member',
      ADD COLUMN comment_count integer NOT NULL DEFAULT 0,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
    ALTER TABLE public.community_comments
      ALTER COLUMN id SET DEFAULT gen_random_uuid(),
      ADD COLUMN content text NOT NULL DEFAULT 'fixture comment',
      ADD COLUMN upvote_count integer NOT NULL DEFAULT 0,
      ADD COLUMN is_deleted boolean NOT NULL DEFAULT false,
      ADD COLUMN content_origin public.community_content_origin
        NOT NULL DEFAULT 'member';
    ALTER TABLE public.community_reply_notifications
      ADD COLUMN post_id uuid,
      ADD COLUMN comment_id uuid,
      ADD COLUMN parent_comment_id uuid,
      ADD COLUMN kind text;
    CREATE UNIQUE INDEX fixture_reply_unique
      ON public.community_reply_notifications(recipient_id, comment_id);
  `);
  await db.exec(decisionMigration);
  // Production grants service_role full access to the legacy source table in
  // 20260731185000; this isolated fixture starts after that migration.
  await db.exec("GRANT SELECT ON public.community_posts TO service_role");
  return db;
}

async function resetRole(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

async function asService(db: PGlite) {
  await resetRole(db);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  await db.exec("SET ROLE service_role");
}

async function publish(db: PGlite, title = "계약 밖 추가 비용 확인 경험을 찾습니다") {
  await asService(db);
  const result = await db.query<{ receipt: Receipt }>(
    `SELECT public.community_publish_decision_thread(
      $1::uuid, $2::uuid, $3::uuid, $4, $5,
      'contract_extra_cost', 'extra_charge', '서울',
      'contract_review', 'before_contract', $6, 'none', NULL
    ) AS receipt`,
    [
      AUTHOR,
      PUBLISH_KEY,
      QUESTION,
      title,
      "계약 전에 포함 범위를 확인한 실제 경험과 확인 순서를 알고 싶어요.",
      "추가 비용을 발견한 시점과 확인 문구",
    ],
  );
  return result.rows[0].receipt;
}

async function registerAndAcceptSupply(db: PGlite) {
  await asService(db);
  await db.query(
    `SELECT public.community_bind_responder_question_requester(
      $1::uuid, $2::uuid, 'contract_extra_cost', 'extra_charge',
      $3::uuid, $4::uuid
    )`,
    [QUESTION, AUTHOR, ADMIN, PUBLISH_KEY],
  );
  const responders = [
    {
      id: PRIMARY,
      role: "primary",
      slotKey: "32000000-0000-4000-8000-000000000001",
      reviewKey: "33000000-0000-4000-8000-000000000001",
      requestKey: "34000000-0000-4000-8000-000000000001",
      acceptKey: "35000000-0000-4000-8000-000000000001",
    },
    {
      id: BACKUP,
      role: "backup",
      slotKey: "32000000-0000-4000-8000-000000000002",
      reviewKey: "33000000-0000-4000-8000-000000000002",
      requestKey: "34000000-0000-4000-8000-000000000002",
      acceptKey: "35000000-0000-4000-8000-000000000002",
    },
  ];
  for (const responder of responders) {
    const slot = await db.query<{ receipt: { slot_id: string } }>(
      `SELECT public.community_register_responder_capacity_slot(
        $1::uuid, 'member', 'contract_extra_cost', 'extra_charge',
        'within_6_months', 'none', false,
        clock_timestamp() - interval '1 hour',
        clock_timestamp() + interval '14 days',
        3::smallint, 1::smallint, 2::smallint, $2::uuid
      ) AS receipt`,
      [responder.id, responder.slotKey],
    );
    await db.query(
      `SELECT public.community_review_responder_capacity_slot(
        $1::uuid, $2::uuid, 'verify',
        'founding_cohort_human_check_passed', $3::uuid
      )`,
      [slot.rows[0].receipt.slot_id, ADMIN, responder.reviewKey],
    );
    const request = await db.query<{ receipt: { request_id: string } }>(
      `SELECT public.community_create_bound_responder_request(
        $1::uuid, $2::uuid, $3::uuid, $4, 'contract_extra_cost',
        'extra_charge', clock_timestamp() + interval '1 day',
        $5::uuid, $6::uuid, $7::uuid
      ) AS receipt`,
      [
        QUESTION,
        AUTHOR,
        slot.rows[0].receipt.slot_id,
        responder.role,
        ADMIN,
        PUBLISH_KEY,
        responder.requestKey,
      ],
    );
    await db.query(
      `SELECT public.community_respond_responder_request(
        $1::uuid, $2::uuid, 'accept', 'none', false, NULL, $3::uuid
      )`,
      [responder.id, request.rows[0].receipt.request_id, responder.acceptKey],
    );
  }
}

async function publishPreparedDecisionThread(
  db: PGlite,
  publication: PublicationFixture,
  ensureServiceRole = true,
) {
  if (ensureServiceRole) await asService(db);
  const result = await db.query<{ receipt: Receipt }>(
    `SELECT public.community_publish_decision_thread(
      $1::uuid, $2::uuid, $3::uuid, $4, $5,
      'contract_extra_cost', 'extra_charge', NULL,
      'contract_review', 'before_contract', $6, 'none', NULL
    ) AS receipt`,
    [
      publication.actorId,
      publication.publishKey,
      publication.questionId,
      "Contract extra fee experience request",
      "Please share direct experience checking included services and unexpected extra charges before signing.",
      "Contract wording, timing, and the result you confirmed",
    ],
  );
  return result.rows[0].receipt;
}

async function registerAndAcceptSupplyFor(
  db: PGlite,
  publication: PublicationFixture,
) {
  const responders = [
    { id: randomUUID(), role: "primary" },
    { id: randomUUID(), role: "backup" },
  ];
  await resetRole(db);
  await db.query(
    "INSERT INTO auth.users (id) VALUES ($1::uuid), ($2::uuid)",
    responders.map((responder) => responder.id),
  );
  await db.query(
    `INSERT INTO public.community_profiles (user_id, nickname)
     VALUES ($1::uuid, 'capacity-primary'), ($2::uuid, 'capacity-backup')`,
    responders.map((responder) => responder.id),
  );
  await asService(db);
  await db.query(
    `SELECT public.community_bind_responder_question_requester(
      $1::uuid, $2::uuid, 'contract_extra_cost', 'extra_charge',
      $3::uuid, $4::uuid
    )`,
    [
      publication.questionId,
      publication.actorId,
      ADMIN,
      publication.publishKey,
    ],
  );
  for (const responder of responders) {
    const slot = await db.query<{ receipt: { slot_id: string } }>(
      `SELECT public.community_register_responder_capacity_slot(
        $1::uuid, 'member', 'contract_extra_cost', 'extra_charge',
        'within_6_months', 'none', false,
        clock_timestamp() - interval '1 hour',
        clock_timestamp() + interval '14 days',
        3::smallint, 1::smallint, 2::smallint, $2::uuid
      ) AS receipt`,
      [responder.id, randomUUID()],
    );
    await db.query(
      `SELECT public.community_review_responder_capacity_slot(
        $1::uuid, $2::uuid, 'verify',
        'founding_cohort_human_check_passed', $3::uuid
      )`,
      [slot.rows[0].receipt.slot_id, ADMIN, randomUUID()],
    );
    const request = await db.query<{ receipt: { request_id: string } }>(
      `SELECT public.community_create_bound_responder_request(
        $1::uuid, $2::uuid, $3::uuid, $4, 'contract_extra_cost',
        'extra_charge', clock_timestamp() + interval '1 day',
        $5::uuid, $6::uuid, $7::uuid
      ) AS receipt`,
      [
        publication.questionId,
        publication.actorId,
        slot.rows[0].receipt.slot_id,
        responder.role,
        ADMIN,
        publication.publishKey,
        randomUUID(),
      ],
    );
    await db.query(
      `SELECT public.community_respond_responder_request(
        $1::uuid, $2::uuid, 'accept', 'none', false, NULL, $3::uuid
      )`,
      [responder.id, request.rows[0].receipt.request_id, randomUUID()],
    );
  }
}

type SeededThread = {
  thread_id: string;
  post_id: string;
};

async function seedActiveDecisionThreads(db: PGlite, count: number) {
  await resetRole(db);
  const result = await db.query<SeededThread>(`
    WITH seed AS (
      SELECT
        gen_random_uuid() AS thread_id,
        gen_random_uuid() AS post_id,
        ordinality
      FROM generate_series(1, $1::integer) WITH ORDINALITY
    ), inserted_posts AS (
      INSERT INTO public.community_posts (
        id, author_id, title, content, visibility, under_review,
        publication_state
      )
      SELECT
        post_id, $2::uuid, 'Capacity seed ' || ordinality,
        'Published capacity fixture with enough content for the decision boundary.',
        'public', false, 'published'
      FROM seed
      RETURNING id
    )
    INSERT INTO public.community_decision_threads (
      id, post_id, author_id, topic_category, experience_scope,
      preparation_stage, contract_phase, desired_answer, state
    )
    SELECT
      seed.thread_id, seed.post_id, $2::uuid, 'contract_extra_cost',
      'extra_charge', 'contract_review', 'before_contract',
      'Direct experience and confirmed contract wording', 'open'
    FROM seed
    JOIN inserted_posts ON inserted_posts.id = seed.post_id
    RETURNING id AS thread_id, post_id
  `, [count, AUTHOR]);
  return result.rows;
}

async function seedReleasedDecisionThreads(db: PGlite) {
  await resetRole(db);
  await db.query(`
    WITH seed(state, publication_state, thread_id, post_id) AS (
      VALUES
        ('completed', 'published', gen_random_uuid(), gen_random_uuid()),
        ('closed', 'published', gen_random_uuid(), gen_random_uuid()),
        ('open', 'withdrawn', gen_random_uuid(), gen_random_uuid())
    ), inserted_posts AS (
      INSERT INTO public.community_posts (
        id, author_id, title, content, visibility, under_review,
        publication_state
      )
      SELECT
        post_id, $1::uuid, 'Released capacity seed',
        'Released capacity fixture with enough content for the decision boundary.',
        CASE WHEN publication_state = 'withdrawn' THEN 'draft' ELSE 'public' END,
        false, publication_state
      FROM seed
      RETURNING id
    )
    INSERT INTO public.community_decision_threads (
      id, post_id, author_id, topic_category, experience_scope,
      preparation_stage, contract_phase, desired_answer, state,
      resolved_at, next_action, resolution_reason, completed_at, closed_reason
    )
    SELECT
      seed.thread_id, seed.post_id, $1::uuid, 'contract_extra_cost',
      'extra_charge', 'contract_review', 'before_contract',
      'Direct experience and confirmed contract wording', seed.state,
      CASE WHEN seed.state = 'completed' THEN clock_timestamp() END,
      CASE WHEN seed.state = 'completed' THEN 'Outcome recorded' END,
      CASE WHEN seed.state = 'completed' THEN 'Author completed the loop' END,
      CASE WHEN seed.state = 'completed' THEN clock_timestamp() END,
      CASE WHEN seed.state = 'closed' THEN 'Operator closed the thread' END
    FROM seed
    JOIN inserted_posts ON inserted_posts.id = seed.post_id
  `, [AUTHOR]);
}

async function activeDecisionThreadCount(db: PGlite) {
  const result = await db.query<{ count: number }>(`
    SELECT count(*)::integer AS count
    FROM public.community_decision_threads AS thread
    LEFT JOIN public.community_posts AS post ON post.id = thread.post_id
    WHERE thread.state NOT IN ('completed', 'closed')
      AND (post.id IS NULL OR post.publication_state IS DISTINCT FROM 'withdrawn')
  `);
  return result.rows[0].count;
}

async function readThread(db: PGlite, viewerId: string | null) {
  await asService(db);
  const result = await db.query<{ projection: Receipt | null }>(
    "SELECT public.community_get_decision_thread($1::uuid, $2::uuid) AS projection",
    [QUESTION, viewerId],
  );
  return result.rows[0].projection;
}

describe("DecisionThread vertical migration", () => {
  it("keeps the founding beta at 20 active threads without moderation or concurrency bypasses", async () => {
    const db = await createDatabase();
    try {
      await resetRole(db);
      await db.query(
        `INSERT INTO public.community_decision_beta_members (author_id)
         VALUES ($1::uuid)`,
        [AUTHOR],
      );
      const activeThreads = await seedActiveDecisionThreads(db, 20);
      await seedReleasedDecisionThreads(db);
      expect(await activeDecisionThreadCount(db)).toBe(20);

      const moderated = activeThreads[0];
      await resetRole(db);
      await db.query(
        `UPDATE public.community_posts
         SET visibility = 'draft', under_review = true
         WHERE id = $1::uuid`,
        [moderated.post_id],
      );

      await registerAndAcceptSupply(db);
      const hiddenCapacityReceipt = await publish(db);
      expect(hiddenCapacityReceipt).toMatchObject({
        status: "private_waitlist",
        question_id: QUESTION,
      });
      const hiddenGate = await db.query<{ safe_error_code: string }>(
        `SELECT safe_error_code
         FROM public.community_commands
         WHERE actor_id = $1::uuid
           AND operation = 'decision_thread_publish'
           AND idempotency_key = $2::uuid`,
        [AUTHOR, PUBLISH_KEY],
      );
      expect(hiddenGate.rows[0]?.safe_error_code).toBe(
        "active_thread_capacity_full",
      );

      await resetRole(db);
      await db.query(
        `UPDATE public.community_posts
         SET visibility = 'public', under_review = false
         WHERE id = $1::uuid`,
        [moderated.post_id],
      );
      const restoredCapacityReceipt = await publish(db);
      expect(restoredCapacityReceipt).toMatchObject({
        status: "private_waitlist",
        question_id: QUESTION,
      });
      expect(await activeDecisionThreadCount(db)).toBe(20);

      const released = activeThreads[1];
      await resetRole(db);
      await db.query(
        `UPDATE public.community_decision_threads
         SET state = 'completed', resolved_at = clock_timestamp(),
             next_action = 'Outcome recorded',
             resolution_reason = 'Author completed the loop',
             completed_at = clock_timestamp()
         WHERE id = $1::uuid`,
        [released.thread_id],
      );
      const published = await publish(db);
      expect(published).toMatchObject({
        status: "published",
        thread_id: QUESTION,
      });
      expect(await activeDecisionThreadCount(db)).toBe(20);

      const exactReplayAtCapacity = await publish(db);
      expect(exactReplayAtCapacity).toEqual(published);

      await asService(db);
      const withdrawal = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_withdraw_decision_thread(
          $1::uuid, $2::uuid, $3::bigint, $4, $5::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          published.current_version,
          "Author withdrew the public source",
          "30000000-0000-4000-8000-000000000102",
        ],
      );
      expect(withdrawal.rows[0].receipt).toMatchObject({ status: "withdrawn" });
      expect(await activeDecisionThreadCount(db)).toBe(19);

      const withdrawalReleasePublication: PublicationFixture = {
        actorId: AUTHOR,
        questionId: "20000000-0000-4000-8000-000000000102",
        publishKey: "30000000-0000-4000-8000-000000000103",
      };
      await registerAndAcceptSupplyFor(db, withdrawalReleasePublication);
      const publishedAfterWithdrawal = await publishPreparedDecisionThread(
        db,
        withdrawalReleasePublication,
      );
      expect(publishedAfterWithdrawal).toMatchObject({ status: "published" });
      expect(await activeDecisionThreadCount(db)).toBe(20);

      await resetRole(db);
      await db.query(`
        UPDATE public.community_decision_threads
        SET state = 'closed',
            closed_reason = COALESCE(closed_reason, 'Capacity test cleanup')
      `);
      await db.query(`
        WITH new_users AS (
          INSERT INTO auth.users (id)
          SELECT gen_random_uuid() FROM generate_series(1, 19)
          RETURNING id
        )
        INSERT INTO public.community_decision_beta_members (author_id)
        SELECT id FROM new_users
      `);

      const betaBoundaryPublication: PublicationFixture = {
        actorId: VIEWER,
        questionId: "20000000-0000-4000-8000-000000000101",
        publishKey: "30000000-0000-4000-8000-000000000101",
      };
      await registerAndAcceptSupplyFor(db, betaBoundaryPublication);
      const betaBoundaryReceipt = await publishPreparedDecisionThread(
        db,
        betaBoundaryPublication,
      );
      expect(betaBoundaryReceipt).toMatchObject({ status: "private_waitlist" });
      const betaGate = await db.query<{ safe_error_code: string }>(
        `SELECT safe_error_code
         FROM public.community_commands
         WHERE actor_id = $1::uuid
           AND operation = 'decision_thread_publish'
           AND idempotency_key = $2::uuid`,
        [betaBoundaryPublication.actorId, betaBoundaryPublication.publishKey],
      );
      expect(betaGate.rows[0]?.safe_error_code).toBe("beta_capacity_full");

      await seedActiveDecisionThreads(db, 19);
      const concurrentPublications: PublicationFixture[] = [
        {
          actorId: AUTHOR,
          questionId: "20000000-0000-4000-8000-000000000201",
          publishKey: "30000000-0000-4000-8000-000000000201",
        },
        {
          actorId: AUTHOR,
          questionId: "20000000-0000-4000-8000-000000000202",
          publishKey: "30000000-0000-4000-8000-000000000202",
        },
      ];
      for (const publication of concurrentPublications) {
        await registerAndAcceptSupplyFor(db, publication);
      }
      await asService(db);
      const concurrentReceipts = await Promise.all(
        concurrentPublications.map((publication) =>
          publishPreparedDecisionThread(db, publication, false),
        ),
      );
      expect(
        concurrentReceipts.map((receipt) => receipt.status).sort(),
      ).toEqual(["private_waitlist", "published"]);
      expect(await activeDecisionThreadCount(db)).toBe(20);

      const publishFunctionStart = decisionMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.community_publish_decision_thread",
      );
      const publishFunctionEnd = decisionMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.community_recalculate_decision_thread",
        publishFunctionStart,
      );
      const publishFunction = decisionMigration.slice(
        publishFunctionStart,
        publishFunctionEnd,
      );
      expect(publishFunction.indexOf("v_command.status IN")).toBeLessThan(
        publishFunction.indexOf("pg_advisory_xact_lock"),
      );
      expect(publishFunction.indexOf("pg_advisory_xact_lock")).toBeLessThan(
        publishFunction.indexOf("active_thread_capacity_full"),
      );
      expect(publishFunction.indexOf("active_thread_capacity_full")).toBeLessThan(
        publishFunction.indexOf("beta_capacity_full"),
      );
    } finally {
      await db.close();
    }
  }, 60_000);

  it("runs in dependency order and closes the private-to-completed loop", async () => {
    const db = await createDatabase();
    try {
      const privateReceipt = await publish(db);
      expect(privateReceipt).toMatchObject({
        status: "private_waitlist",
        question_id: QUESTION,
        operation_key: PUBLISH_KEY,
        replayed: false,
      });
      expect(await readThread(db, VIEWER)).toBeNull();
      expect(await readThread(db, AUTHOR)).toMatchObject({
        status: "private_waitlist",
        viewer: { isAuthor: true, canWithdraw: true },
      });

      await registerAndAcceptSupply(db);
      const published = await publish(db);
      expect(published).toMatchObject({
        status: "published",
        thread_id: QUESTION,
        publication_version: 1,
        current_version: 1,
        operation_key: PUBLISH_KEY,
        replayed: false,
      });
      await resetRole(db);
      await expect(
        db.query(
          "UPDATE public.community_posts SET images = ARRAY['https://example.com/leak.jpg'] WHERE id = $1::uuid",
          [published.post_id],
        ),
      ).rejects.toThrow(/PUBLIC_SOURCE_IS_IMMUTABLE/u);

      await asService(db);
      const answerResult = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_decision_answer(
          $1::uuid, $2::uuid, $3::uuid, $4, 'experience', true,
          'within_6_months', 'contract_review', '서울', $5, $6, $7, $8,
          'none', NULL
        ) AS receipt`,
        [
          PRIMARY,
          QUESTION,
          "36000000-0000-4000-8000-000000000001",
          "저는 계약서의 포함 항목 표를 기준으로 추가 비용을 확인했어요.",
          "포함 항목을 서면으로 다시 요청했어요",
          "추가 결제 없이 포함 범위를 확인했어요",
          "계약서 특약과 견적서 항목을 함께 확인하세요",
          "제 계약에서 확인한 사실과 개인 의견을 구분했어요",
        ],
      );
      const answer = answerResult.rows[0].receipt;
      expect(answer).toMatchObject({
        status: "answered",
        state: "answered",
        operation_key: "36000000-0000-4000-8000-000000000001",
      });
      const answerReplay = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_decision_answer(
          $1::uuid, $2::uuid, $3::uuid, $4, 'experience', true,
          'within_6_months', 'contract_review', '서울', $5, $6, $7, $8,
          'none', NULL
        ) AS receipt`,
        [
          PRIMARY,
          QUESTION,
          "36000000-0000-4000-8000-000000000001",
          "저는 계약서의 포함 항목 표를 기준으로 추가 비용을 확인했어요.",
          "포함 항목을 서면으로 다시 요청했어요",
          "추가 결제 없이 포함 범위를 확인했어요",
          "계약서 특약과 견적서 항목을 함께 확인하세요",
          "제 계약에서 확인한 사실과 개인 의견을 구분했어요",
        ],
      );
      expect(answerReplay.rows[0].receipt).toEqual(answer);
      const answerId = answer.answer_id as string;
      let version = answer.version as number;
      await resetRole(db);
      await expect(
        db.query(
          `UPDATE public.community_comments SET content = 'edited source'
           WHERE id = $1::uuid`,
          [answer.comment_id],
        ),
      ).rejects.toThrow(/ANSWER_SOURCE_IS_IMMUTABLE/u);

      await resetRole(db);
      await db.query(
        "UPDATE public.community_profiles SET is_suspended = true WHERE user_id = $1::uuid",
        [PRIMARY],
      );
      let projection = await readThread(db, AUTHOR);
      expect(projection).toMatchObject({
        thread: { qualifiedPeerAnswerCount: 0 },
        answers: [],
      });
      await resetRole(db);
      await db.query(
        "UPDATE public.community_profiles SET is_suspended = false WHERE user_id = $1::uuid",
        [PRIMARY],
      );
      projection = await readThread(db, AUTHOR);
      expect(projection).toMatchObject({
        thread: { qualifiedPeerAnswerCount: 1 },
      });
      expect((projection?.answers as unknown[]).length).toBe(1);
      version = (projection?.thread as { version: number }).version;

      await asService(db);
      await db.query(
        "SELECT public.community_set_user_block($1::uuid, $2::uuid, true, 'irrelevant')",
        [AUTHOR, PRIMARY],
      );
      projection = await readThread(db, AUTHOR);
      expect(projection).toMatchObject({
        thread: { qualifiedPeerAnswerCount: 0 },
        answers: [],
      });
      await asService(db);
      await db.query(
        "SELECT public.community_set_user_block($1::uuid, $2::uuid, false, NULL)",
        [AUTHOR, PRIMARY],
      );

      projection = await readThread(db, AUTHOR);
      version = (projection?.thread as { version: number }).version;
      await asService(db);
      const applicabilityResult = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_set_decision_applicability(
          $1::uuid, $2::uuid, $3::bigint, $4::uuid,
          'taken_as_next_action', $5::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          version,
          answerId,
          "37000000-0000-4000-8000-000000000001",
        ],
      );
      expect(applicabilityResult.rows[0].receipt).toMatchObject({
        operation_key: "37000000-0000-4000-8000-000000000001",
      });
      const applicabilityReplay = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_set_decision_applicability(
          $1::uuid, $2::uuid, $3::bigint, $4::uuid,
          'taken_as_next_action', $5::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          version,
          answerId,
          "37000000-0000-4000-8000-000000000001",
        ],
      );
      expect(applicabilityReplay.rows[0].receipt).toEqual(
        applicabilityResult.rows[0].receipt,
      );
      version = applicabilityResult.rows[0].receipt.version as number;
      const resolutionResult = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_finalize_decision_thread_resolution(
          $1::uuid, $2::uuid, $3::bigint, ARRAY[$4::uuid], $5, $6, $7::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          version,
          answerId,
          "계약서 포함 범위를 서면으로 다시 확인하기",
          "실제 계약 단계와 조건이 같아서 적용했어요",
          "38000000-0000-4000-8000-000000000001",
        ],
      );
      const resolution = resolutionResult.rows[0].receipt;
      expect(resolution).toMatchObject({
        status: "resolved",
        operation_key: "38000000-0000-4000-8000-000000000001",
      });
      const resolutionReplay = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_finalize_decision_thread_resolution(
          $1::uuid, $2::uuid, $3::bigint, ARRAY[$4::uuid], $5, $6, $7::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          version,
          answerId,
          "계약서 포함 범위를 서면으로 다시 확인하기",
          "실제 계약 단계와 조건이 같아서 적용했어요",
          "38000000-0000-4000-8000-000000000001",
        ],
      );
      expect(resolutionReplay.rows[0].receipt).toEqual(resolution);
      expect(resolution.selection_ids).toHaveLength(1);
      version = resolution.version as number;

      await asService(db);
      const consentedOutcome = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_record_decision_outcome(
          $1::uuid, $2::uuid, $3::bigint, NULL, $4, $5, $6,
          true, 'none', NULL, $7::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          version,
          "계약서 포함 범위를 다시 확인했어요",
          "추가 결제 없이 범위를 확정했어요",
          "동일한 포함 항목 표가 있는 계약에 적용돼요",
          "39000000-0000-4000-8000-000000000001",
        ],
      );
      expect(consentedOutcome.rows[0].receipt).toMatchObject({
        status: "completed",
        revision: 1,
        operation_key: "39000000-0000-4000-8000-000000000001",
      });
      const outcomeReplay = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_record_decision_outcome(
          $1::uuid, $2::uuid, $3::bigint, NULL, $4, $5, $6,
          true, 'none', NULL, $7::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          version,
          "계약서 포함 범위를 다시 확인했어요",
          "추가 결제 없이 범위를 확정했어요",
          "동일한 포함 항목 표가 있는 계약에 적용돼요",
          "39000000-0000-4000-8000-000000000001",
        ],
      );
      expect(outcomeReplay.rows[0].receipt).toEqual(
        consentedOutcome.rows[0].receipt,
      );
      expect(await readThread(db, VIEWER)).toMatchObject({
        viewer: { outcomes: [] },
      });

      await resetRole(db);
      await db.query(
        `UPDATE public.community_comments SET is_deleted = true
         WHERE id = (
           SELECT comment_id FROM public.community_decision_answers
           WHERE id = $1::uuid
         )`,
        [answerId],
      );
      projection = await readThread(db, AUTHOR);
      expect(projection).toMatchObject({
        thread: {
          sourceUnavailableAt: expect.any(String),
          newApplicationsAllowed: false,
          qualifiedPeerAnswerCount: 0,
        },
        answers: [],
        viewer: { selection: [] },
      });
      version = (projection?.thread as { version: number }).version;

      await asService(db);
      const privateOutcome = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_record_decision_outcome(
          $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5, $6, $7,
          false, 'none', NULL, $8::uuid
        ) AS receipt`,
        [
          AUTHOR,
          QUESTION,
          version,
          consentedOutcome.rows[0].receipt.outcome_id,
          "계약서 포함 범위를 다시 확인했어요",
          "추가 결제 없이 범위를 확정했어요",
          "동일한 포함 항목 표가 있는 계약에 적용돼요",
          "39000000-0000-4000-8000-000000000002",
        ],
      );
      expect(privateOutcome.rows[0].receipt).toMatchObject({
        status: "completed",
        state: "completed",
        revision: 2,
      });

      await expect(
        db.query(
          `SELECT public.community_record_decision_outcome(
            $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5, $6, $7,
            true, 'none', NULL, $8::uuid
          )`,
          [
            AUTHOR,
            QUESTION,
            privateOutcome.rows[0].receipt.version,
            privateOutcome.rows[0].receipt.outcome_id,
            "공개 결과 수정",
            "공개 결과 설명",
            "공개 적용 조건",
            "3a000000-0000-4000-8000-000000000001",
          ],
        ),
      ).rejects.toThrow(/PUBLIC_OUTCOME_SOURCE_UNAVAILABLE/u);

      const replay = await publish(db);
      expect(replay).toEqual(published);
      await expect(
        publish(db, "같은 키로 다른 질문 제목을 보내면 충돌합니다"),
      ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/u);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps raw decision tables service-only", async () => {
    const db = await createDatabase();
    try {
      const grants = await db.query<{ role_name: string; table_name: string }>(`
        SELECT grantee AS role_name, table_name
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name LIKE 'community_decision%'
          AND privilege_type = 'SELECT'
          AND grantee IN ('anon', 'authenticated')
      `);
      expect(grants.rows).toEqual([]);
      expect(decisionMigration).not.toContain(
        "community_resolve_decision_thread",
      );
      expect(
        decisionMigration.match(
          /^CREATE OR REPLACE FUNCTION public\.community_withdraw_decision_thread/gmu,
        ),
      ).toHaveLength(1);
    } finally {
      await db.close();
    }
  }, 30_000);
});
