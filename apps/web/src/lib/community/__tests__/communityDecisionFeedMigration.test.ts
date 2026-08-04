// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804193000_community_decision_feed_read.sql",
  ),
  "utf8",
);
const reviewMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804194000_community_decision_outcome_review.sql",
  ),
  "utf8",
);
const publicOutcomeMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804195000_community_decision_public_outcome_read.sql",
  ),
  "utf8",
);

const AUTHOR = "10000000-0000-4000-8000-000000000001";
const RESPONDER = "10000000-0000-4000-8000-000000000002";
const OTHER = "10000000-0000-4000-8000-000000000003";
const THREAD = "20000000-0000-4000-8000-000000000001";
const POST = "30000000-0000-4000-8000-000000000001";
const OUTCOME_ONE = "40000000-0000-4000-8000-000000000001";
const OUTCOME_TWO = "40000000-0000-4000-8000-000000000002";

type Feed = {
  items: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextCursor: { at: string; id: string } | null;
  mode: string;
};

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA community_private;

    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users (id) VALUES
      ('${AUTHOR}'), ('${RESPONDER}'), ('${OTHER}');

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
    );
    INSERT INTO public.profiles (id, is_admin) VALUES
      ('${AUTHOR}', false), ('${RESPONDER}', false), ('${OTHER}', true);

    CREATE TABLE public.community_runtime_controls (
      singleton boolean PRIMARY KEY DEFAULT true,
      mode text NOT NULL DEFAULT 'normal'
    );
    INSERT INTO public.community_runtime_controls(singleton, mode)
    VALUES (true, 'normal');

    CREATE OR REPLACE FUNCTION public.community_runtime_mode()
    RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT mode FROM public.community_runtime_controls WHERE singleton
    $$;
    CREATE OR REPLACE FUNCTION public.community_assert_decision_service()
    RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
    BEGIN
      IF COALESCE(current_setting('request.jwt.claim.role', true), '')
          <> 'service_role' THEN
        RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
      END IF;
    END
    $$;
    CREATE OR REPLACE FUNCTION public.community_decision_payload_digest(
      p_payload jsonb
    ) RETURNS text LANGUAGE sql IMMUTABLE AS $$
      SELECT md5(p_payload::text) || md5('decision:' || p_payload::text)
    $$;
    CREATE OR REPLACE FUNCTION public.community_decision_public_text_is_safe(
      p_value text
    ) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT p_value IS NULL OR p_value !~*
        '[[:alnum:]_.%+\\-]+@[[:alnum:].\\-]+\\.[[:alpha:]]{2,}'
    $$;

    CREATE TABLE community_private.community_user_blocks (
      blocker_id uuid NOT NULL,
      blocked_id uuid NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE OR REPLACE FUNCTION community_private.users_are_blocked(
      p_left uuid,
      p_right uuid
    ) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS (
        SELECT 1 FROM community_private.community_user_blocks AS block
        WHERE (block.blocker_id = p_left AND block.blocked_id = p_right)
           OR (block.blocker_id = p_right AND block.blocked_id = p_left)
      )
    $$;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      badge text NOT NULL DEFAULT 'member',
      is_suspended boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid,
      title text NOT NULL,
      content text NOT NULL,
      content_origin text NOT NULL DEFAULT 'member',
      commercial_relationship text NOT NULL DEFAULT 'none',
      sponsorship_detail text,
      publication_state text,
      audience_scope text,
      visibility text NOT NULL DEFAULT 'public',
      author_visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_decision_threads (
      id uuid PRIMARY KEY,
      post_id uuid,
      author_id uuid,
      state text NOT NULL,
      version bigint NOT NULL DEFAULT 1,
      kind text NOT NULL DEFAULT 'experience_question',
      topic_category text NOT NULL DEFAULT 'contract_extra_cost',
      experience_scope text NOT NULL DEFAULT 'extra_charge',
      coarse_region text,
      preparation_stage text NOT NULL DEFAULT 'contract_review',
      contract_phase text NOT NULL DEFAULT 'before_contract',
      desired_answer text NOT NULL DEFAULT '계약 전 확인할 문구',
      source_unavailable_at timestamptz,
      new_applications_allowed boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      content text NOT NULL DEFAULT 'verified source answer',
      is_deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_decision_answers (
      id uuid PRIMARY KEY,
      thread_id uuid NOT NULL,
      comment_id uuid,
      author_id uuid,
      content_origin text NOT NULL,
      is_qualified boolean NOT NULL DEFAULT true,
      commercial_relationship text NOT NULL DEFAULT 'none',
      sponsorship_detail text
    );
    CREATE TABLE public.community_thread_evidence_selections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid NOT NULL,
      answer_id uuid NOT NULL,
      applicability text NOT NULL DEFAULT 'applies',
      included_in_resolution_at timestamptz,
      selected_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.community_responder_requests (
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL,
      responder_id uuid NOT NULL,
      status text NOT NULL,
      expires_at timestamptz NOT NULL,
      response_has_conflict boolean
    );
    CREATE TABLE public.community_decision_thread_intakes (
      question_id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.community_decision_outcomes (
      id uuid PRIMARY KEY,
      thread_id uuid NOT NULL,
      author_id uuid,
      revision integer NOT NULL,
      supersedes_outcome_id uuid,
      action_taken text NOT NULL,
      result_summary text NOT NULL,
      applicable_conditions text NOT NULL,
      public_consent boolean NOT NULL DEFAULT false,
      consent_version smallint NOT NULL DEFAULT 1,
      commercial_relationship text NOT NULL,
      sponsorship_detail text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (thread_id, revision)
    );

    INSERT INTO public.community_profiles(user_id, nickname) VALUES
      ('${AUTHOR}', '준비하는봄'),
      ('${RESPONDER}', '먼저해본여름'),
      ('${OTHER}', '다른경험자');

    GRANT USAGE ON SCHEMA public, community_private TO
      anon, authenticated, service_role;
  `);
  await db.exec(migration);
  await db.exec(reviewMigration);
  await db.exec(publicOutcomeMigration);
  return db;
}

async function resetRole(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false)",
  );
}

async function setRole(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
) {
  await resetRole(db);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false)",
    [role],
  );
  await db.exec(`SET ROLE ${role}`);
}

async function insertThread(db: PGlite, state = "completed") {
  await db.exec(`
    INSERT INTO public.community_posts (
      id, author_id, title, content, publication_state, audience_scope
    ) VALUES (
      '${POST}', '${AUTHOR}', '계약 뒤 추가금이 생긴 경험이 있나요?',
      '원본 파일 포함 범위를 계약 전에 어떻게 확인했는지 궁금해요.',
      'published', 'public'
    );
    INSERT INTO public.community_decision_threads (
      id, post_id, author_id, state
    ) VALUES ('${THREAD}', '${POST}', '${AUTHOR}', '${state}');
  `);
}

async function insertReviewedProjection(db: PGlite) {
  await insertThread(db);
  await db.exec(`
    INSERT INTO public.community_comments (id, content)
    VALUES (
      '50000000-0000-4000-8000-000000000031',
      'The signed scope and quote were checked together.'
    );
    INSERT INTO public.community_decision_answers (
      id, thread_id, comment_id, author_id, content_origin
    ) VALUES (
      '50000000-0000-4000-8000-000000000032',
      '${THREAD}', '50000000-0000-4000-8000-000000000031',
      '${RESPONDER}', 'member'
    );
    INSERT INTO public.community_thread_evidence_selections (
      id, thread_id, answer_id, applicability, included_in_resolution_at
    ) VALUES (
      '50000000-0000-4000-8000-000000000033',
      '${THREAD}', '50000000-0000-4000-8000-000000000032',
      'taken_as_next_action', clock_timestamp()
    );
    INSERT INTO public.community_decision_outcomes (
      id, thread_id, author_id, revision, action_taken, result_summary,
      applicable_conditions, public_consent, commercial_relationship
    ) VALUES (
      '${OUTCOME_ONE}', '${THREAD}', '${AUTHOR}', 1,
      'Asked the vendor to honor the signed scope.',
      'The extra charge was removed before payment.',
      'This applies when the signed scope lists the same item.',
      true, 'none'
    );
    UPDATE public.community_decision_outcome_publications
    SET publication_state = 'published',
        reviewed_by = '${OTHER}',
        reviewed_at = clock_timestamp(),
        review_reason = 'Human review confirmed source and privacy.',
        review_policy_version = 'p0-human-v1',
        published_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE outcome_id = '${OUTCOME_ONE}';
  `);
}

async function getPublicOutcome(
  db: PGlite,
  viewerId: string | null,
) {
  await setRole(db, "service_role");
  const result = await db.query<{ outcome: Record<string, unknown> | null }>(
    "SELECT public.community_get_decision_public_outcome($1::uuid, $2::uuid) AS outcome",
    [THREAD, viewerId],
  );
  await resetRole(db);
  return result.rows[0].outcome;
}

async function getFeed(
  db: PGlite,
  viewerId: string | null,
  mode: "for_you" | "needs_help" | "outcomes",
) {
  await setRole(db, "service_role");
  const result = await db.query<{ feed: Feed }>(
    `SELECT public.community_list_decision_threads(
       $1::uuid, $2::text, NULL, NULL, 10
     ) AS feed`,
    [viewerId, mode],
  );
  await resetRole(db);
  return result.rows[0].feed;
}

async function getInbox(db: PGlite, viewerId: string) {
  await setRole(db, "service_role");
  const result = await db.query<{ inbox: {
    waitingReplies: { count: number };
    experienceNeeded: { count: number };
    returnedOutcomes: { count: number };
  } }>(
    "SELECT public.community_get_decision_inbox($1::uuid) AS inbox",
    [viewerId],
  );
  await resetRole(db);
  return result.rows[0].inbox;
}

describe("community decision feed projection migration", () => {
  it("keeps the exact public outcome projection service-only and fail-closed", async () => {
    const db = await createDatabase();
    await insertReviewedProjection(db);

    const guestProjection = await getPublicOutcome(db, null);
    expect(guestProjection).toEqual({
      id: OUTCOME_ONE,
      revision: 1,
      actionTaken: "Asked the vendor to honor the signed scope.",
      resultSummary: "The extra charge was removed before payment.",
      applicableConditions: "This applies when the signed scope lists the same item.",
      commercialRelationship: "none",
      sponsorshipDetail: null,
      createdAt: expect.any(String),
    });
    expect(await getPublicOutcome(db, OTHER)).toEqual(guestProjection);

    await db.exec(`
      INSERT INTO public.community_comments (id, content)
      VALUES (
        '50000000-0000-4000-8000-000000000034',
        'A second selected source must remain live as well.'
      );
      INSERT INTO public.community_decision_answers (
        id, thread_id, comment_id, author_id, content_origin
      ) VALUES (
        '50000000-0000-4000-8000-000000000035',
        '${THREAD}', '50000000-0000-4000-8000-000000000034',
        '${OTHER}', 'member'
      );
      INSERT INTO public.community_thread_evidence_selections (
        id, thread_id, answer_id, applicability, included_in_resolution_at
      ) VALUES (
        '50000000-0000-4000-8000-000000000036',
        '${THREAD}', '50000000-0000-4000-8000-000000000035',
        'taken_as_next_action', clock_timestamp()
      );
      UPDATE public.community_comments
      SET is_deleted = true
      WHERE id = '50000000-0000-4000-8000-000000000034';
    `);
    expect(await getPublicOutcome(db, null)).toBeNull();
    expect((await getFeed(db, null, "outcomes")).items).toEqual([]);
    await db.exec(`
      UPDATE public.community_comments
      SET is_deleted = false
      WHERE id = '50000000-0000-4000-8000-000000000034';
    `);
    expect(await getPublicOutcome(db, null)).toEqual(guestProjection);

    await setRole(db, "anon");
    await expect(db.query(
      "SELECT public.community_get_decision_public_outcome($1::uuid, NULL)",
      [THREAD],
    )).rejects.toThrow(/permission denied|service role required/iu);
    await resetRole(db);
    await setRole(db, "authenticated");
    await expect(db.query(
      "SELECT public.community_get_decision_public_outcome($1::uuid, $2::uuid)",
      [THREAD, OTHER],
    )).rejects.toThrow(/permission denied|service role required/iu);
    await resetRole(db);

    await db.exec(`
      INSERT INTO community_private.community_user_blocks(blocker_id, blocked_id)
      VALUES ('${OTHER}', '${AUTHOR}');
    `);
    expect(await getPublicOutcome(db, OTHER)).toBeNull();
    await db.exec("DELETE FROM community_private.community_user_blocks");

    expect((await getInbox(db, OTHER)).returnedOutcomes.count).toBe(1);
    await db.exec(`
      INSERT INTO community_private.community_user_blocks(blocker_id, blocked_id)
      VALUES ('${OTHER}', '${RESPONDER}');
    `);
    expect(await getPublicOutcome(db, OTHER)).toBeNull();
    expect((await getFeed(db, OTHER, "outcomes")).items).toEqual([]);
    expect((await getInbox(db, OTHER)).returnedOutcomes.count).toBe(0);
    await db.exec("DELETE FROM community_private.community_user_blocks");

    await db.exec(`
      INSERT INTO community_private.community_user_blocks(blocker_id, blocked_id)
      VALUES ('${AUTHOR}', '${RESPONDER}');
    `);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec("DELETE FROM community_private.community_user_blocks");

    await db.exec(`UPDATE public.community_profiles SET is_suspended = true
      WHERE user_id = '${AUTHOR}'`);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec(`UPDATE public.community_profiles SET is_suspended = false
      WHERE user_id = '${AUTHOR}'`);
    await db.exec(`UPDATE public.community_profiles SET is_suspended = true
      WHERE user_id = '${RESPONDER}'`);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec(`UPDATE public.community_profiles SET is_suspended = false
      WHERE user_id = '${RESPONDER}'`);

    await db.exec(`UPDATE public.community_runtime_controls SET mode = 'disabled'
      WHERE singleton = true`);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec(`UPDATE public.community_runtime_controls SET mode = 'normal'
      WHERE singleton = true`);

    await db.exec(`UPDATE public.community_posts SET publication_state = 'deleted'
      WHERE id = '${POST}'`);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec(`UPDATE public.community_posts SET publication_state = 'published'
      WHERE id = '${POST}'`);
    await db.exec(`UPDATE public.community_decision_threads
      SET source_unavailable_at = clock_timestamp() WHERE id = '${THREAD}'`);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec(`UPDATE public.community_decision_threads
      SET source_unavailable_at = NULL WHERE id = '${THREAD}'`);

    await db.exec(`UPDATE public.community_decision_outcome_publications
      SET action_taken = 'Contact bride@example.com before payment.'
      WHERE outcome_id = '${OUTCOME_ONE}'`);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec(`UPDATE public.community_decision_outcome_publications
      SET action_taken = 'Asked the vendor to honor the signed scope.'
      WHERE outcome_id = '${OUTCOME_ONE}'`);

    await db.exec(`UPDATE public.community_decision_threads SET author_id = NULL
      WHERE id = '${THREAD}'`);
    expect(await getPublicOutcome(db, null)).toBeNull();
    await db.exec(`UPDATE public.community_decision_threads SET author_id = '${AUTHOR}'
      WHERE id = '${THREAD}'`);

    await db.exec(`
      INSERT INTO public.community_decision_outcomes (
        id, thread_id, author_id, revision, supersedes_outcome_id,
        action_taken, result_summary, applicable_conditions,
        public_consent, commercial_relationship
      ) VALUES (
        '${OUTCOME_TWO}', '${THREAD}', '${AUTHOR}', 2, '${OUTCOME_ONE}',
        'Private revision for bride@example.com.',
        'This newer canonical result remains private.',
        'Private notes only.', false, 'none'
      );
      UPDATE public.community_decision_outcome_publications
      SET publication_state = 'published',
          withdrawn_at = NULL,
          withdrawn_reason = NULL,
          published_at = clock_timestamp()
      WHERE outcome_id = '${OUTCOME_ONE}';
    `);
    expect(await getPublicOutcome(db, null)).toBeNull();

    await db.exec(`DELETE FROM public.community_decision_outcomes
      WHERE id = '${OUTCOME_TWO}'`);
    await db.exec(`UPDATE public.community_decision_outcome_publications
      SET publication_state = 'withdrawn',
          withdrawn_at = clock_timestamp(),
          withdrawn_reason = 'consent_withdrawn',
          published_at = NULL
      WHERE outcome_id = '${OUTCOME_ONE}'`);
    expect(await getPublicOutcome(db, null)).toBeNull();

    await db.close();
  });

  it("durably withdraws a public projection when its source becomes unavailable", async () => {
    const db = await createDatabase();
    await insertReviewedProjection(db);
    await db.exec(`
      UPDATE public.community_decision_threads
      SET source_unavailable_at = clock_timestamp()
      WHERE id = '${THREAD}';
    `);

    const publication = await db.query<{
      publication_state: string;
      withdrawn_reason: string;
    }>(`
      SELECT publication_state, withdrawn_reason
      FROM public.community_decision_outcome_publications
      WHERE outcome_id = '${OUTCOME_ONE}'
    `);
    expect(publication.rows[0]).toEqual({
      publication_state: "withdrawn",
      withdrawn_reason: "source_unavailable",
    });

    await setRole(db, "service_role");
    const ownerState = await db.query<{ state: Record<string, unknown> }>(
      `SELECT public.community_get_decision_outcome_publication_state(
        $1::uuid, $2::uuid, $3::uuid
      ) AS state`,
      [AUTHOR, THREAD, OUTCOME_ONE],
    );
    expect(ownerState.rows[0].state).toMatchObject({
      publicationState: "withdrawn",
      canWithdraw: false,
    });
    await resetRole(db);
    await db.close();
  });

  it("records an author source withdrawal in the publication state", async () => {
    const db = await createDatabase();
    await insertReviewedProjection(db);
    await db.exec(`
      BEGIN;
      SELECT set_config(
        'hanbang.community_decision_source_write', 'on', true
      );
      UPDATE public.community_posts
      SET publication_state = 'withdrawn', visibility = 'draft'
      WHERE id = '${POST}';
      COMMIT;
    `);

    const publication = await db.query<{
      publication_state: string;
      withdrawn_reason: string;
    }>(`
      SELECT publication_state, withdrawn_reason
      FROM public.community_decision_outcome_publications
      WHERE outcome_id = '${OUTCOME_ONE}'
    `);
    expect(publication.rows[0]).toEqual({
      publication_state: "withdrawn",
      withdrawn_reason: "author_withdrawn",
    });
    await db.close();
  });

  it("keeps consented canonical outcomes private until a reviewed projection is published", async () => {
    const db = await createDatabase();
    await insertThread(db);
    await db.exec(`
      INSERT INTO public.community_comments (id, content)
      VALUES (
        '50000000-0000-4000-8000-000000000011',
        'The signed scope and the quote were checked together.'
      );
      INSERT INTO public.community_decision_answers (
        id, thread_id, comment_id, author_id, content_origin
      ) VALUES (
        '50000000-0000-4000-8000-000000000012',
        '${THREAD}', '50000000-0000-4000-8000-000000000011',
        '${RESPONDER}', 'member'
      );
      INSERT INTO public.community_thread_evidence_selections (
        id, thread_id, answer_id, applicability, included_in_resolution_at
      ) VALUES (
        '50000000-0000-4000-8000-000000000013',
        '${THREAD}', '50000000-0000-4000-8000-000000000012',
        'taken_as_next_action', clock_timestamp()
      );
      INSERT INTO public.community_decision_outcomes (
        id, thread_id, author_id, revision, action_taken, result_summary,
        applicable_conditions, public_consent, commercial_relationship
      ) VALUES (
        '${OUTCOME_ONE}', '${THREAD}', '${AUTHOR}', 1,
        '계약서에 포함 범위를 추가했어요.',
        '추가 결제 없이 원본을 받았어요.',
        '원본 제공 조항이 없는 계약 전 단계에 해당해요.',
        true, 'none'
      );
    `);

    const pending = await db.query<{
      publication_state: string;
      action_taken: string;
    }>(`
      SELECT publication_state, action_taken
      FROM public.community_decision_outcome_publications
      WHERE outcome_id = '${OUTCOME_ONE}'
    `);
    expect(pending.rows).toEqual([{
      publication_state: "pending_review",
      action_taken: "계약서에 포함 범위를 추가했어요.",
    }]);
    await setRole(db, "service_role");
    const ownerPublication = await db.query<{ state: Record<string, unknown> | null }>(
      `SELECT public.community_get_decision_outcome_publication_state(
        $1::uuid, $2::uuid, $3::uuid
      ) AS state`,
      [AUTHOR, THREAD, OUTCOME_ONE],
    );
    const otherPublication = await db.query<{ state: null }>(
      `SELECT public.community_get_decision_outcome_publication_state(
        $1::uuid, $2::uuid, $3::uuid
      ) AS state`,
      [RESPONDER, THREAD, OUTCOME_ONE],
    );
    expect(ownerPublication.rows[0].state).toMatchObject({
      outcomeId: OUTCOME_ONE,
      publicationState: "pending_review",
      canWithdraw: true,
    });
    expect(otherPublication.rows[0].state).toBeNull();
    await resetRole(db);
    expect((await getFeed(db, RESPONDER, "outcomes")).items).toEqual([]);

    await db.exec(`
      UPDATE public.community_decision_outcome_publications
      SET publication_state = 'published',
          reviewed_by = '${OTHER}',
          reviewed_at = clock_timestamp(),
          review_reason = '사람 검수와 공개 조건을 통과했어요.',
          review_policy_version = 'p0-human-v1',
          published_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE outcome_id = '${OUTCOME_ONE}';
    `);
    const published = await getFeed(db, RESPONDER, "outcomes");
    expect(published.items).toHaveLength(1);
    expect(published.items[0]).toMatchObject({
      threadId: THREAD,
      outcome: {
        id: OUTCOME_ONE,
        resultSummary: "추가 결제 없이 원본을 받았어요.",
      },
    });

    await setRole(db, "service_role");
    const publicOutcome = await db.query<{ outcome: Record<string, unknown> | null }>(
      "SELECT public.community_get_decision_public_outcome($1::uuid, $2::uuid) AS outcome",
      [THREAD, RESPONDER],
    );
    expect(publicOutcome.rows[0].outcome).toMatchObject({
      id: OUTCOME_ONE,
      resultSummary: "추가 결제 없이 원본을 받았어요.",
    });
    await resetRole(db);

    await db.exec(`
      UPDATE public.community_comments
      SET is_deleted = true
      WHERE id = '50000000-0000-4000-8000-000000000011';
    `);
    expect((await getFeed(db, RESPONDER, "outcomes")).items).toEqual([]);
    await setRole(db, "service_role");
    const unavailableOutcome = await db.query<{ outcome: null }>(
      "SELECT public.community_get_decision_public_outcome($1::uuid, $2::uuid) AS outcome",
      [THREAD, RESPONDER],
    );
    expect(unavailableOutcome.rows[0].outcome).toBeNull();
    await resetRole(db);
    await db.exec(`
      UPDATE public.community_comments
      SET is_deleted = false
      WHERE id = '50000000-0000-4000-8000-000000000011';
    `);

    await db.exec(`
      INSERT INTO public.community_decision_outcomes (
        id, thread_id, author_id, revision, supersedes_outcome_id,
        action_taken, result_summary, applicable_conditions,
        public_consent, commercial_relationship
      ) VALUES (
        '${OUTCOME_TWO}', '${THREAD}', '${AUTHOR}', 2, '${OUTCOME_ONE}',
        '내용을 다시 정리했어요.', '결과는 비공개로 바꿨어요.',
        '개인 기록으로만 남겨요.', false, 'none'
      );
    `);
    const withdrawn = await db.query<{ publication_state: string }>(`
      SELECT publication_state
      FROM public.community_decision_outcome_publications
      WHERE outcome_id = '${OUTCOME_ONE}'
    `);
    expect(withdrawn.rows[0].publication_state).toBe("withdrawn");
    expect((await getFeed(db, RESPONDER, "outcomes")).items).toEqual([]);
    await setRole(db, "service_role");
    const withdrawnPublication = await db.query<{ state: Record<string, unknown> }>(
      `SELECT public.community_get_decision_outcome_publication_state(
        $1::uuid, $2::uuid, $3::uuid
      ) AS state`,
      [AUTHOR, THREAD, OUTCOME_ONE],
    );
    expect(withdrawnPublication.rows[0].state).toMatchObject({
      publicationState: "withdrawn",
      canWithdraw: false,
    });
    await resetRole(db);
    await db.close();
  });

  it("shows needs-help only to the live assigned responder and respects blocks", async () => {
    const db = await createDatabase();
    await insertThread(db, "open");
    await db.exec(`
      INSERT INTO public.community_responder_requests (
        id, question_id, responder_id, status, expires_at,
        response_has_conflict
      ) VALUES (
        '50000000-0000-4000-8000-000000000001',
        '${THREAD}', '${RESPONDER}', 'accepted',
        clock_timestamp() + interval '1 day', false
      );
    `);

    expect((await getFeed(db, null, "needs_help")).items).toEqual([]);
    expect((await getFeed(db, OTHER, "needs_help")).items).toEqual([]);
    expect((await getFeed(db, RESPONDER, "needs_help")).items).toHaveLength(1);
    expect((await getInbox(db, RESPONDER)).experienceNeeded.count).toBe(1);

    await db.exec(`UPDATE public.community_profiles
      SET is_suspended = true WHERE user_id = '${RESPONDER}'`);
    expect((await getFeed(db, RESPONDER, "needs_help")).items).toEqual([]);
    expect((await getInbox(db, RESPONDER)).experienceNeeded.count).toBe(0);
    await db.exec(`UPDATE public.community_profiles
      SET is_suspended = false WHERE user_id = '${RESPONDER}'`);

    await db.exec(`
      INSERT INTO community_private.community_user_blocks(blocker_id, blocked_id)
      VALUES ('${RESPONDER}', '${AUTHOR}');
    `);
    expect((await getFeed(db, RESPONDER, "needs_help")).items).toEqual([]);
    await db.close();
  });

  it("does not count a qualified answer after its author profile is gone", async () => {
    const db = await createDatabase();
    await insertThread(db, "open");
    await db.exec(`
      INSERT INTO public.community_comments (id, content)
      VALUES (
        '50000000-0000-4000-8000-000000000041',
        '계정 삭제 전 남긴 답변이에요.'
      );
      INSERT INTO public.community_decision_answers (
        id, thread_id, comment_id, author_id, content_origin
      ) VALUES (
        '50000000-0000-4000-8000-000000000042',
        '${THREAD}', '50000000-0000-4000-8000-000000000041',
        '${RESPONDER}', 'member'
      );
    `);

    const beforeDeletion = await getFeed(db, null, "for_you");
    expect(beforeDeletion.items[0]?.qualifiedPeerAnswerCount).toBe(1);

    await db.exec(`
      UPDATE public.community_decision_answers
      SET author_id = NULL
      WHERE id = '50000000-0000-4000-8000-000000000042';
      DELETE FROM public.community_profiles WHERE user_id = '${RESPONDER}';
    `);

    const afterDeletion = await getFeed(db, null, "for_you");
    expect(afterDeletion.items[0]?.qualifiedPeerAnswerCount).toBe(0);
    await db.close();
  });

  it("derives factual inbox counts and does not grant raw projection reads", async () => {
    const db = await createDatabase();
    await insertThread(db, "open");
    const WAITLIST = "60000000-0000-4000-8000-000000000001";
    await db.exec(`
      INSERT INTO public.community_decision_thread_intakes (
        question_id, author_id, status
      ) VALUES ('${WAITLIST}', '${AUTHOR}', 'private_waitlist');
      INSERT INTO public.community_responder_requests (
        id, question_id, responder_id, status, expires_at,
        response_has_conflict
      ) VALUES (
        '50000000-0000-4000-8000-000000000001',
        '${THREAD}', '${RESPONDER}', 'accepted',
        clock_timestamp() + interval '1 day', false
      );
    `);

    await setRole(db, "service_role");
    const inbox = await db.query<{ inbox: {
      waitingReplies: { count: number; targetQuestionId: string };
      experienceNeeded: { count: number; targetThreadId: string };
      returnedOutcomes: { count: number };
    } }>(
      "SELECT public.community_get_decision_inbox($1::uuid) AS inbox",
      [RESPONDER],
    );
    expect(inbox.rows[0].inbox).toMatchObject({
      waitingReplies: { count: 0 },
      experienceNeeded: { count: 1, targetThreadId: THREAD },
      returnedOutcomes: { count: 0 },
    });
    await resetRole(db);

    await setRole(db, "service_role");
    const authorInbox = await db.query<{ inbox: {
      waitingReplies: { count: number; targetQuestionId: string };
    } }>(
      "SELECT public.community_get_decision_inbox($1::uuid) AS inbox",
      [AUTHOR],
    );
    expect(authorInbox.rows[0].inbox.waitingReplies).toMatchObject({
      count: 2,
      targetQuestionId: WAITLIST,
    });
    await resetRole(db);

    await setRole(db, "authenticated");
    await expect(db.query(
      "SELECT * FROM public.community_decision_outcome_publications",
    )).rejects.toThrow(/permission denied|row-level security/iu);
    await resetRole(db);
    await db.close();
  });

  it("publishes only through human review and lets the author withdraw in disabled mode", async () => {
    const db = await createDatabase();
    await insertThread(db);
    const reviewKey = "70000000-0000-4000-8000-000000000001";
    const withdrawKey = "70000000-0000-4000-8000-000000000002";
    await db.exec(`
      INSERT INTO public.community_comments (id, content)
      VALUES (
        '50000000-0000-4000-8000-000000000021',
        'The signed scope and the quote were checked together.'
      );
      INSERT INTO public.community_decision_answers (
        id, thread_id, comment_id, author_id, content_origin
      ) VALUES (
        '50000000-0000-4000-8000-000000000022',
        '${THREAD}', '50000000-0000-4000-8000-000000000021',
        '${RESPONDER}', 'member'
      );
      INSERT INTO public.community_thread_evidence_selections (
        id, thread_id, answer_id, applicability, included_in_resolution_at
      ) VALUES (
        '50000000-0000-4000-8000-000000000023',
        '${THREAD}', '50000000-0000-4000-8000-000000000022',
        'taken_as_next_action', clock_timestamp()
      );
      INSERT INTO public.community_decision_outcomes (
        id, thread_id, author_id, revision, action_taken, result_summary,
        applicable_conditions, public_consent, commercial_relationship
      ) VALUES (
        '${OUTCOME_ONE}', '${THREAD}', '${AUTHOR}', 1,
        'Asked the vendor to honor the signed scope.',
        'The extra charge was removed before payment.',
        'This applies when the signed scope lists the same item.',
        true, 'none'
      );
    `);

    await setRole(db, "service_role");
    const queue = await db.query<{ queue: {
      items: Array<{ outcomeId: string; sourceAvailable: boolean }>;
    } }>(
      "SELECT public.community_list_decision_outcome_reviews('pending_review', NULL, NULL, 20) AS queue",
    );
    expect(queue.rows[0].queue.items).toEqual([
      expect.objectContaining({ outcomeId: OUTCOME_ONE, sourceAvailable: true }),
    ]);

    const review = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'publish', $3::text, $4::text, $5::uuid
      ) AS receipt`,
      [OTHER, OUTCOME_ONE, "Human review confirmed source and privacy.", "p0-human-v1", reviewKey],
    );
    expect(review.rows[0].receipt).toMatchObject({
      publicationState: "published",
      replayed: false,
    });
    const replay = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'publish', $3::text, $4::text, $5::uuid
      ) AS receipt`,
      [OTHER, OUTCOME_ONE, "Human review confirmed source and privacy.", "p0-human-v1", reviewKey],
    );
    expect(replay.rows[0].receipt).toEqual(review.rows[0].receipt);
    const exactReviewReceipt = await db.query<{ matches: boolean }>(
      `SELECT public.community_has_completed_decision_publication_command(
        $1::uuid, 'review_publish', $2::uuid, $3::uuid,
        jsonb_build_object(
          'outcomeId', $3::uuid,
          'decision', 'publish',
          'reason', $4::text,
          'policyVersion', $5::text
        )
      ) AS matches`,
      [OTHER, reviewKey, OUTCOME_ONE, "Human review confirmed source and privacy.", "p0-human-v1"],
    );
    const changedReviewReceipt = await db.query<{ matches: boolean }>(
      `SELECT public.community_has_completed_decision_publication_command(
        $1::uuid, 'review_publish', $2::uuid, $3::uuid,
        jsonb_build_object(
          'outcomeId', $3::uuid,
          'decision', 'publish',
          'reason', $4::text,
          'policyVersion', $5::text
        )
      ) AS matches`,
      [OTHER, reviewKey, OUTCOME_ONE, "Different reason must not bypass gates.", "p0-human-v1"],
    );
    expect(exactReviewReceipt.rows[0].matches).toBe(true);
    expect(changedReviewReceipt.rows[0].matches).toBe(false);
    await expect(db.query(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'publish', $3::text, $4::text, $5::uuid
      )`,
      [OTHER, OUTCOME_ONE, "Different reason must conflict.", "p0-human-v1", reviewKey],
    )).rejects.toThrow(/IDEMPOTENCY_CONFLICT/iu);

    await resetRole(db);
    await db.exec(`
      UPDATE public.community_runtime_controls SET mode = 'disabled'
      WHERE singleton = true;
    `);
    await setRole(db, "service_role");
    const disabledReplay = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'publish', $3::text, $4::text, $5::uuid
      ) AS receipt`,
      [OTHER, OUTCOME_ONE, "Human review confirmed source and privacy.", "p0-human-v1", reviewKey],
    );
    expect(disabledReplay.rows[0].receipt).toEqual(review.rows[0].receipt);
    const withdrawn = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_withdraw_decision_outcome_publication(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid
      ) AS receipt`,
      [AUTHOR, THREAD, OUTCOME_ONE, withdrawKey],
    );
    expect(withdrawn.rows[0].receipt).toMatchObject({
      publicationState: "withdrawn",
      replayed: false,
    });
    const withdrawnReplay = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_withdraw_decision_outcome_publication(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid
      ) AS receipt`,
      [AUTHOR, THREAD, OUTCOME_ONE, withdrawKey],
    );
    expect(withdrawnReplay.rows[0].receipt).toEqual(
      withdrawn.rows[0].receipt,
    );
    await resetRole(db);

    expect((await getFeed(db, RESPONDER, "outcomes")).items).toEqual([]);
    await setRole(db, "authenticated");
    await expect(db.query(
      "SELECT * FROM public.community_decision_publication_commands",
    )).rejects.toThrow(/permission denied|row-level security/iu);
    await resetRole(db);
    await db.close();
  });

  it("replays a human rejection as the exact durable receipt", async () => {
    const db = await createDatabase();
    await insertThread(db);
    const reviewKey = "70000000-0000-4000-8000-000000000003";
    await db.exec(`
      INSERT INTO public.community_decision_outcomes (
        id, thread_id, author_id, revision, action_taken, result_summary,
        applicable_conditions, public_consent, commercial_relationship
      ) VALUES (
        '${OUTCOME_ONE}', '${THREAD}', '${AUTHOR}', 1,
        'Asked for the signed scope in writing.',
        'The vendor replied before payment.',
        'Only the signed scope is relevant.',
        true, 'none'
      );
    `);
    await setRole(db, "service_role");
    const first = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'reject', $3::text, $4::text, $5::uuid
      ) AS receipt`,
      [OTHER, OUTCOME_ONE, "Human review found unsafe public detail.", "p0-human-v1", reviewKey],
    );
    const replay = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'reject', $3::text, $4::text, $5::uuid
      ) AS receipt`,
      [OTHER, OUTCOME_ONE, "Human review found unsafe public detail.", "p0-human-v1", reviewKey],
    );
    expect(first.rows[0].receipt).toMatchObject({
      operationKey: reviewKey,
      publicationState: "rejected",
      replayed: false,
    });
    expect(replay.rows[0].receipt).toEqual(first.rows[0].receipt);
    await resetRole(db);
    await db.close();
  });

  it("refuses publication when any selected final evidence is unavailable", async () => {
    const db = await createDatabase();
    await insertThread(db);
    await db.exec(`
      INSERT INTO public.community_comments (id, content, is_deleted) VALUES
        (
          '50000000-0000-4000-8000-000000000051',
          'The first selected source remains live.', false
        ),
        (
          '50000000-0000-4000-8000-000000000052',
          'The second selected source was deleted.', true
        );
      INSERT INTO public.community_decision_answers (
        id, thread_id, comment_id, author_id, content_origin
      ) VALUES
        (
          '50000000-0000-4000-8000-000000000053', '${THREAD}',
          '50000000-0000-4000-8000-000000000051', '${RESPONDER}', 'member'
        ),
        (
          '50000000-0000-4000-8000-000000000054', '${THREAD}',
          '50000000-0000-4000-8000-000000000052', '${OTHER}', 'member'
        );
      INSERT INTO public.community_thread_evidence_selections (
        id, thread_id, answer_id, applicability, included_in_resolution_at
      ) VALUES
        (
          '50000000-0000-4000-8000-000000000055', '${THREAD}',
          '50000000-0000-4000-8000-000000000053',
          'taken_as_next_action', clock_timestamp()
        ),
        (
          '50000000-0000-4000-8000-000000000056', '${THREAD}',
          '50000000-0000-4000-8000-000000000054',
          'taken_as_next_action', clock_timestamp()
        );
      INSERT INTO public.community_decision_outcomes (
        id, thread_id, author_id, revision, action_taken, result_summary,
        applicable_conditions, public_consent, commercial_relationship
      ) VALUES (
        '${OUTCOME_ONE}', '${THREAD}', '${AUTHOR}', 1,
        'Asked for the signed scope in writing.',
        'The vendor replied before payment.',
        'Only the signed scope is relevant.',
        true, 'none'
      );
    `);
    await setRole(db, "service_role");
    const queue = await db.query<{ queue: {
      items: Array<{ outcomeId: string; sourceAvailable: boolean }>;
    } }>(
      "SELECT public.community_list_decision_outcome_reviews('pending_review', NULL, NULL, 20) AS queue",
    );
    expect(queue.rows[0].queue.items).toEqual([
      expect.objectContaining({ outcomeId: OUTCOME_ONE, sourceAvailable: false }),
    ]);
    await expect(db.query(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'publish', $3::text, $4::text, $5::uuid
      )`,
      [
        OTHER,
        OUTCOME_ONE,
        "Human review cannot replace missing evidence.",
        "p0-human-v1",
        "70000000-0000-4000-8000-000000000003",
      ],
    )).rejects.toThrow(/SOURCE_UNAVAILABLE/iu);
    await resetRole(db);
    const state = await db.query<{ publication_state: string }>(`
      SELECT publication_state
      FROM public.community_decision_outcome_publications
      WHERE outcome_id = '${OUTCOME_ONE}'
    `);
    expect(state.rows[0].publication_state).toBe("pending_review");
    await db.close();
  });

  it("blocks publish during an emergency mode while preserving reject and account deletion", async () => {
    const db = await createDatabase();
    await insertThread(db);
    await db.exec(`
      INSERT INTO public.community_comments (id, content)
      VALUES (
        '50000000-0000-4000-8000-000000000031',
        'The signed scope and quote were checked together.'
      );
      INSERT INTO public.community_decision_answers (
        id, thread_id, comment_id, author_id, content_origin
      ) VALUES (
        '50000000-0000-4000-8000-000000000032',
        '${THREAD}', '50000000-0000-4000-8000-000000000031',
        '${RESPONDER}', 'member'
      );
      INSERT INTO public.community_thread_evidence_selections (
        id, thread_id, answer_id, applicability, included_in_resolution_at
      ) VALUES (
        '50000000-0000-4000-8000-000000000033',
        '${THREAD}', '50000000-0000-4000-8000-000000000032',
        'taken_as_next_action', clock_timestamp()
      );
      INSERT INTO public.community_decision_outcomes (
        id, thread_id, author_id, revision, action_taken, result_summary,
        applicable_conditions, public_consent, commercial_relationship
      ) VALUES (
        '${OUTCOME_ONE}', '${THREAD}', '${AUTHOR}', 1,
        'Asked for the signed scope in writing.',
        'The vendor replied before payment.',
        'Only the signed scope is relevant.',
        true, 'none'
      );
      UPDATE public.community_runtime_controls SET mode = 'read_only'
      WHERE singleton = true;
    `);

    await setRole(db, "service_role");
    await expect(db.query(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'publish', $3::text, $4::text, $5::uuid
      )`,
      [
        OTHER,
        OUTCOME_ONE,
        "Publishing must stop during an emergency.",
        "p0-human-v1",
        "70000000-0000-4000-8000-000000000011",
      ],
    )).rejects.toThrow(/RUNTIME_BLOCKED/iu);

    const rejected = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_review_decision_outcome(
        $1::uuid, $2::uuid, 'reject', $3::text, $4::text, $5::uuid
      ) AS receipt`,
      [
        OTHER,
        OUTCOME_ONE,
        "Reject remains a safe removal action.",
        "p0-human-v1",
        "70000000-0000-4000-8000-000000000012",
      ],
    );
    expect(rejected.rows[0].receipt).toMatchObject({
      publicationState: "rejected",
    });
    await resetRole(db);

    await db.exec(`DELETE FROM auth.users WHERE id = '${OTHER}'`);
    const commands = await db.query<{
      actor_id: null;
      actor_erased_at: string;
    }>(`
      SELECT actor_id, actor_erased_at
      FROM public.community_decision_publication_commands
      WHERE outcome_id = '${OUTCOME_ONE}'
        AND operation = 'review_reject'
    `);
    expect(commands.rows).toHaveLength(1);
    expect(commands.rows[0].actor_id).toBeNull();
    expect(commands.rows[0].actor_erased_at).toBeTruthy();
    const publication = await db.query<{ reviewed_by: null }>(`
      SELECT reviewed_by
      FROM public.community_decision_outcome_publications
      WHERE outcome_id = '${OUTCOME_ONE}'
    `);
    expect(publication.rows[0].reviewed_by).toBeNull();
    await db.close();
  });
});
