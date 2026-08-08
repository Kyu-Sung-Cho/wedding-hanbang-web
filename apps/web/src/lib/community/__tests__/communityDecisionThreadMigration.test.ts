import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804190000_community_decision_thread_vertical.sql",
  ),
  "utf8",
);

const databases: PGlite[] = [];

function extractFunction(name: string) {
  const match = migrationSql.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "u",
  ));
  if (!match) throw new Error(`Missing function ${name}`);
  return match[0];
}

function extractStatement(start: string, nextStart: string) {
  const startIndex = migrationSql.indexOf(start);
  const endIndex = migrationSql.indexOf(nextStart, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing statement ${start}`);
  return migrationSql.slice(startIndex, endIndex).trim();
}

async function createDecisionReadModelDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE SCHEMA community_private;
    CREATE TABLE public.community_decision_threads (
      id uuid PRIMARY KEY, post_id uuid, author_id uuid, state text,
      version bigint, kind text, topic_category text, experience_scope text,
      coarse_region text, preparation_stage text, contract_phase text,
      desired_answer text, qualified_peer_answer_count integer,
      qualified_professional_answer_count integer, next_action text,
      resolved_at timestamptz, completed_at timestamptz,
      source_unavailable_at timestamptz, new_applications_allowed boolean,
      created_at timestamptz
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY, author_id uuid, publication_state text,
      audience_scope text, visibility text, author_visibility text,
      under_review boolean, title text, content text, content_origin text,
      commercial_relationship text, sponsorship_detail text,
      created_at timestamptz
    );
    CREATE TABLE public.community_decision_thread_intakes (
      question_id uuid PRIMARY KEY, author_id uuid, status text, title text,
      content text, topic_category text, experience_scope text,
      coarse_region text, preparation_stage text, contract_phase text,
      desired_answer text, commercial_relationship text,
      sponsorship_detail text, created_at timestamptz
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY, nickname text, badge text, is_suspended boolean
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY, content text, is_deleted boolean
    );
    CREATE TABLE public.community_decision_answers (
      id uuid PRIMARY KEY, thread_id uuid, comment_id uuid, author_id uuid,
      response_kind text, content_origin text, direct_experience boolean,
      experience_period text, experience_stage text, coarse_region text,
      action_taken text, result_summary text, next_check text,
      fact_opinion_boundary text, commercial_relationship text,
      sponsorship_detail text, rubric_version smallint, is_qualified boolean,
      created_at timestamptz
    );
    CREATE TABLE public.community_thread_evidence_selections (
      id uuid PRIMARY KEY, thread_id uuid, author_id uuid, answer_id uuid,
      comment_id uuid, applicability text, selected_at timestamptz,
      included_in_resolution_at timestamptz
    );
    CREATE TABLE public.community_decision_outcomes (
      id uuid PRIMARY KEY, thread_id uuid, author_id uuid, revision integer,
      supersedes_outcome_id uuid, action_taken text, result_summary text,
      applicable_conditions text, public_consent boolean,
      commercial_relationship text, sponsorship_detail text,
      created_at timestamptz
    );
    CREATE TABLE public.community_responder_requests (
      question_id uuid, responder_id uuid, status text, expires_at timestamptz,
      response_has_conflict boolean
    );
    CREATE FUNCTION public.community_assert_decision_service()
    RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
    CREATE FUNCTION public.community_runtime_mode()
    RETURNS text LANGUAGE sql STABLE AS 'SELECT ''normal''::text';
    CREATE FUNCTION community_private.users_are_blocked(uuid, uuid)
    RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  `);
  await db.exec(extractFunction("community_get_decision_thread"));
  return db;
}

async function createDecisionWithdrawalDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE SCHEMA extensions;
    CREATE TABLE public.community_commands (
      id uuid PRIMARY KEY, actor_id uuid NOT NULL, operation text NOT NULL,
      idempotency_key uuid NOT NULL, status text NOT NULL,
      result_payload jsonb, UNIQUE (actor_id, operation, idempotency_key)
    );
    CREATE TABLE public.community_decision_thread_intakes (
      question_id uuid PRIMARY KEY, author_id uuid NOT NULL, status text NOT NULL,
      published_post_id uuid, published_thread_id uuid, updated_at timestamptz
    );
    CREATE TABLE public.community_decision_threads (
      id uuid PRIMARY KEY, post_id uuid, author_id uuid, state text,
      version bigint, source_unavailable_at timestamptz,
      new_applications_allowed boolean, updated_at timestamptz
    );
    CREATE TABLE public.community_responder_questions (
      id uuid PRIMARY KEY, intake_status text NOT NULL
    );
    CREATE TABLE public.responder_capacity_slots (
      id uuid PRIMARY KEY, consumed_request_id uuid, updated_at timestamptz
    );
    CREATE TABLE public.community_responder_requests (
      id uuid PRIMARY KEY, question_id uuid NOT NULL,
      responder_id uuid NOT NULL, capacity_slot_id uuid NOT NULL,
      status text NOT NULL, expiry_idempotency_key uuid,
      expiry_reason_code text, expired_at timestamptz, updated_at timestamptz,
      response_commercial_relationship text,
      commercial_relationship_at_request text NOT NULL,
      response_has_conflict boolean, conflict_at_request boolean NOT NULL
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY, publication_state text, visibility text
    );

    CREATE FUNCTION public.community_assert_decision_service()
    RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
    CREATE FUNCTION public.community_open_decision_command(
      p_actor_id uuid, p_operation text, p_idempotency_key uuid, p_payload jsonb
    ) RETURNS public.community_commands LANGUAGE plpgsql AS $$
    DECLARE v_command public.community_commands%ROWTYPE;
    BEGIN
      INSERT INTO public.community_commands (
        id, actor_id, operation, idempotency_key, status
      ) VALUES (
        gen_random_uuid(), p_actor_id, p_operation, p_idempotency_key, 'pending'
      ) ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;
      SELECT command.* INTO v_command FROM public.community_commands AS command
      WHERE command.actor_id = p_actor_id AND command.operation = p_operation
        AND command.idempotency_key = p_idempotency_key;
      RETURN v_command;
    END $$;
    CREATE FUNCTION public.community_complete_decision_command(
      p_command_id uuid, p_status text, p_result_reference uuid,
      p_safe_error_code text DEFAULT NULL, p_result_payload jsonb DEFAULT NULL
    ) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE public.community_commands
      SET status = p_status, result_payload = p_result_payload
      WHERE id = p_command_id;
    END $$;
    CREATE FUNCTION public.community_lock_responder_identity(uuid)
    RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
    CREATE FUNCTION public.community_write_responder_supply_event(
      text, uuid, uuid, uuid, text, uuid, uuid, text, text, text, text, boolean
    ) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
    CREATE FUNCTION public.community_append_decision_event(
      uuid, bigint, text, text, uuid, jsonb, jsonb, text
    ) RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';

    CREATE FUNCTION public.guard_terminal_slot_consumption()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.consumed_request_id IS NOT NULL
        AND NEW.consumed_request_id IS DISTINCT FROM OLD.consumed_request_id THEN
        RAISE EXCEPTION 'consumed_request_id is terminal one-shot'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER responder_capacity_slots_terminal_consumption
    BEFORE UPDATE OF consumed_request_id ON public.responder_capacity_slots
    FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_slot_consumption();
  `);
  await db.exec(extractFunction("community_withdraw_decision_thread"));
  return db;
}

async function createDecisionAnswerDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.community_decision_threads (id uuid PRIMARY KEY);
    CREATE TABLE public.community_comments (id uuid PRIMARY KEY);
    CREATE TABLE public.community_responder_requests (id uuid PRIMARY KEY);
  `);
  await db.exec(extractStatement(
    "CREATE TABLE public.community_decision_answers",
    "CREATE TABLE public.community_thread_evidence_selections",
  ));
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("community decision thread migration", () => {
  it("provides a database fail-closed guard for public contact, date, and exact-address text", async () => {
    const db = await PGlite.create();
    databases.push(db);
    await db.exec(extractFunction("community_decision_public_text_is_safe"));
    const result = await db.query<{
      safe: boolean;
      phone: boolean;
      email: boolean;
      exact_date: boolean;
      exact_address: boolean;
    }>(`SELECT
      public.community_decision_public_text_is_safe(
        '계약 전에 포함 범위를 서면으로 확인했어요'
      ) AS safe,
      public.community_decision_public_text_is_safe('연락처 010-1234-5678') AS phone,
      public.community_decision_public_text_is_safe('test@example.com') AS email,
      public.community_decision_public_text_is_safe('2026-08-04 계약') AS exact_date,
      public.community_decision_public_text_is_safe(
        '서울시 강남구 테헤란로 123에서 만나요'
      ) AS exact_address`);
    expect(result.rows[0]).toEqual({
      safe: true,
      phone: false,
      email: false,
      exact_date: false,
      exact_address: false,
    });
  });

  it("blocks a suspended actor while allowing a new actor without a community profile", async () => {
    const db = await PGlite.create();
    databases.push(db);
    await db.exec(`
      CREATE TABLE public.community_profiles (
        user_id uuid PRIMARY KEY, is_suspended boolean
      );
      ${extractFunction("community_assert_decision_actor_active")}
    `);
    const activeId = "00000000-0000-4000-8000-000000000031";
    const suspendedId = "00000000-0000-4000-8000-000000000032";
    await db.query(
      "INSERT INTO public.community_profiles VALUES ($1, false), ($2, true)",
      [activeId, suspendedId],
    );
    await expect(db.query(
      "SELECT public.community_assert_decision_actor_active($1)",
      [activeId],
    )).resolves.toBeDefined();
    await expect(db.query(
      "SELECT public.community_assert_decision_actor_active($1)",
      ["00000000-0000-4000-8000-000000000033"],
    )).resolves.toBeDefined();
    await expect(db.query(
      "SELECT public.community_assert_decision_actor_active($1)",
      [suspendedId],
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("rechecks selected evidence when either participant changes a block", async () => {
    const db = await PGlite.create();
    databases.push(db);
    await db.exec(`
      CREATE TABLE public.community_decision_threads (
        id uuid PRIMARY KEY, author_id uuid
      );
      CREATE TABLE public.community_decision_answers (
        id uuid PRIMARY KEY, thread_id uuid, author_id uuid
      );
      CREATE TABLE public.community_thread_evidence_selections (
        thread_id uuid, answer_id uuid, included_in_resolution_at timestamptz
      );
      CREATE TABLE public.community_viewer_controls (
        blocker_user_id uuid, blocked_user_id uuid, revoked_at timestamptz
      );
      CREATE TABLE public.recalculation_log (thread_id uuid, reason text);
      CREATE FUNCTION public.community_recalculate_decision_thread(
        p_thread_id uuid, p_actor_type text, p_actor_id uuid, p_reason text
      ) RETURNS public.community_decision_threads LANGUAGE plpgsql AS $$
      DECLARE v_thread public.community_decision_threads%ROWTYPE;
      BEGIN
        INSERT INTO public.recalculation_log VALUES (p_thread_id, p_reason);
        SELECT * INTO v_thread FROM public.community_decision_threads
        WHERE id = p_thread_id;
        RETURN v_thread;
      END $$;
      ${extractFunction("community_recalculate_blocked_decision_sources_trigger")}
      CREATE TRIGGER decision_selected_source_block_changed
      AFTER INSERT OR UPDATE OF revoked_at OR DELETE
      ON public.community_viewer_controls
      FOR EACH ROW EXECUTE FUNCTION
        public.community_recalculate_blocked_decision_sources_trigger();
    `);
    const threadId = "00000000-0000-4000-8000-000000000041";
    const authorId = "00000000-0000-4000-8000-000000000042";
    const answererId = "00000000-0000-4000-8000-000000000043";
    const answerId = "00000000-0000-4000-8000-000000000044";
    await db.query(
      "INSERT INTO public.community_decision_threads VALUES ($1, $2)",
      [threadId, authorId],
    );
    await db.query(
      "INSERT INTO public.community_decision_answers VALUES ($1, $2, $3)",
      [answerId, threadId, answererId],
    );
    await db.query(
      "INSERT INTO public.community_thread_evidence_selections VALUES ($1, $2, now())",
      [threadId, answerId],
    );
    await db.query(
      "INSERT INTO public.community_viewer_controls VALUES ($1, $2, NULL)",
      [authorId, answererId],
    );
    const log = await db.query<{ thread_id: string; reason: string }>(
      "SELECT thread_id, reason FROM public.recalculation_log",
    );
    expect(log.rows).toEqual([{
      thread_id: threadId,
      reason: "selected_source_block_changed",
    }]);
    await db.query("TRUNCATE public.recalculation_log");
    await db.query(
      `DELETE FROM public.community_viewer_controls
       WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
      [authorId, answererId],
    );
    const deleteLog = await db.query<{ thread_id: string; reason: string }>(
      "SELECT thread_id, reason FROM public.recalculation_log",
    );
    expect(deleteLog.rows).toEqual([{
      thread_id: threadId,
      reason: "selected_source_block_changed",
    }]);
  });

  it("rechecks thread sources when an account FK tombstones an author", async () => {
    const db = await PGlite.create();
    databases.push(db);
    await db.exec(`
      CREATE TABLE public.community_decision_threads (
        id uuid PRIMARY KEY, author_id uuid
      );
      CREATE TABLE public.community_decision_answers (
        id uuid PRIMARY KEY, thread_id uuid, author_id uuid
      );
      CREATE TABLE public.recalculation_log (thread_id uuid, reason text);
      CREATE FUNCTION public.community_recalculate_decision_thread(
        p_thread_id uuid, p_actor_type text, p_actor_id uuid, p_reason text
      ) RETURNS public.community_decision_threads LANGUAGE plpgsql AS $$
      DECLARE v_thread public.community_decision_threads%ROWTYPE;
      BEGIN
        INSERT INTO public.recalculation_log VALUES (p_thread_id, p_reason);
        SELECT * INTO v_thread FROM public.community_decision_threads
        WHERE id = p_thread_id;
        RETURN v_thread;
      END $$;
      ${extractFunction("community_recalculate_erased_decision_actor_trigger")}
      CREATE TRIGGER decision_thread_author_erased
      AFTER UPDATE OF author_id ON public.community_decision_threads
      FOR EACH ROW EXECUTE FUNCTION
        public.community_recalculate_erased_decision_actor_trigger();
      CREATE TRIGGER decision_answer_author_erased
      AFTER UPDATE OF author_id ON public.community_decision_answers
      FOR EACH ROW EXECUTE FUNCTION
        public.community_recalculate_erased_decision_actor_trigger();
    `);
    const threadId = "00000000-0000-4000-8000-000000000051";
    const authorId = "00000000-0000-4000-8000-000000000052";
    const answererId = "00000000-0000-4000-8000-000000000053";
    const answerId = "00000000-0000-4000-8000-000000000054";
    await db.query(
      "INSERT INTO public.community_decision_threads VALUES ($1, $2)",
      [threadId, authorId],
    );
    await db.query(
      "INSERT INTO public.community_decision_answers VALUES ($1, $2, $3)",
      [answerId, threadId, answererId],
    );
    await db.query(
      "UPDATE public.community_decision_answers SET author_id = NULL WHERE id = $1",
      [answerId],
    );
    await db.query(
      "UPDATE public.community_decision_threads SET author_id = NULL WHERE id = $1",
      [threadId],
    );
    const log = await db.query<{ thread_id: string; reason: string }>(
      "SELECT thread_id, reason FROM public.recalculation_log ORDER BY ctid",
    );
    expect(log.rows).toEqual([
      { thread_id: threadId, reason: "decision_actor_erased" },
      { thread_id: threadId, reason: "decision_actor_erased" },
    ]);
  });

  it("compiles the private waitlist projection and returns it only to its owner", async () => {
    const db = await createDecisionReadModelDatabase();
    const questionId = "00000000-0000-4000-8000-000000000001";
    const ownerId = "00000000-0000-4000-8000-000000000002";
    const strangerId = "00000000-0000-4000-8000-000000000003";
    await db.query(
      `INSERT INTO public.community_decision_thread_intakes (
        question_id, author_id, status, title, content, topic_category,
        experience_scope, coarse_region, preparation_stage, contract_phase,
        desired_answer, commercial_relationship, sponsorship_detail, created_at
      ) VALUES (
        $1, $2, 'private_waitlist', '계약 뒤 추가금 확인 경험이 궁금해요',
        '계약서에 없던 추가 비용을 안내받은 경험을 듣고 싶어요.',
        'contract_extra_cost', 'extra_charge', '서울 동부', 'contracted',
        'after_contract', '확인한 계약 문구와 실제 결과', 'none', NULL, now()
      )`,
      [questionId, ownerId],
    );

    const ownerResult = await db.query<{ detail: unknown }>(
      "SELECT public.community_get_decision_thread($1, $2) AS detail",
      [questionId, ownerId],
    );
    expect(ownerResult.rows[0]?.detail).toMatchObject({
      status: "private_waitlist",
      intake: { questionId },
      viewer: { isAuthor: true, canWithdraw: true },
    });

    const strangerResult = await db.query<{ detail: unknown }>(
      "SELECT public.community_get_decision_thread($1, $2) AS detail",
      [questionId, strangerId],
    );
    expect(strangerResult.rows[0]?.detail).toBeNull();
  });

  it("withdraws a waitlisted accepted request without releasing its consumed slot", async () => {
    const db = await createDecisionWithdrawalDatabase();
    const questionId = "00000000-0000-4000-8000-000000000011";
    const ownerId = "00000000-0000-4000-8000-000000000012";
    const responderId = "00000000-0000-4000-8000-000000000013";
    const requestId = "00000000-0000-4000-8000-000000000014";
    const slotId = "00000000-0000-4000-8000-000000000015";
    const operationId = "00000000-0000-4000-8000-000000000016";
    await db.query(
      `INSERT INTO public.community_decision_thread_intakes
        (question_id, author_id, status, updated_at)
       VALUES ($1, $2, 'private_waitlist', now())`,
      [questionId, ownerId],
    );
    await db.query(
      `INSERT INTO public.community_responder_questions (id, intake_status)
       VALUES ($1, 'private_waitlist')`,
      [questionId],
    );
    await db.query(
      `INSERT INTO public.responder_capacity_slots
        (id, consumed_request_id, updated_at)
       VALUES ($1, $2, now())`,
      [slotId, requestId],
    );
    await db.query(
      `INSERT INTO public.community_responder_requests (
         id, question_id, responder_id, capacity_slot_id, status,
         commercial_relationship_at_request, conflict_at_request, updated_at
       ) VALUES ($1, $2, $3, $4, 'accepted', 'none', false, now())`,
      [requestId, questionId, responderId, slotId],
    );

    const result = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_withdraw_decision_thread(
        $1, $2, NULL, '더 이상 답변을 기다리지 않아요', $3
      ) AS receipt`,
      [ownerId, questionId, operationId],
    );
    expect(result.rows[0]?.receipt.status).toBe("withdrawn");
    expect(result.rows[0]?.receipt.operation_key).toBe(operationId);
    const replay = await db.query<{ receipt: Record<string, unknown> }>(
      `SELECT public.community_withdraw_decision_thread(
        $1, $2, NULL, '더 이상 답변을 기다리지 않아요', $3
      ) AS receipt`,
      [ownerId, questionId, operationId],
    );
    expect(replay.rows[0]?.receipt).toEqual(result.rows[0]?.receipt);

    const slot = await db.query<{ consumed_request_id: string }>(
      "SELECT consumed_request_id FROM public.responder_capacity_slots WHERE id = $1",
      [slotId],
    );
    expect(slot.rows[0]?.consumed_request_id).toBe(requestId);
    const request = await db.query<{ status: string }>(
      "SELECT status FROM public.community_responder_requests WHERE id = $1",
      [requestId],
    );
    expect(request.rows[0]?.status).toBe("expired");
  });

  it("retains the responder request UUID as an answer audit tombstone after request erasure", async () => {
    const db = await createDecisionAnswerDatabase();
    const threadId = "00000000-0000-4000-8000-000000000021";
    const commentId = "00000000-0000-4000-8000-000000000022";
    const responderId = "00000000-0000-4000-8000-000000000023";
    const requestId = "00000000-0000-4000-8000-000000000024";
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [responderId]);
    await db.query("INSERT INTO public.community_decision_threads (id) VALUES ($1)", [threadId]);
    await db.query("INSERT INTO public.community_comments (id) VALUES ($1)", [commentId]);
    await db.query(
      "INSERT INTO public.community_responder_requests (id) VALUES ($1)",
      [requestId],
    );
    await db.query(
      `INSERT INTO public.community_decision_answers (
        thread_id, comment_id, author_id, responder_request_id, response_kind,
        content_origin, direct_experience, experience_period, experience_stage,
        action_taken, fact_opinion_boundary, commercial_relationship
      ) VALUES (
        $1, $2, $3, $4, 'experience', 'member', true,
        'within_3_months', 'contracted', '계약서를 다시 확인함',
        '직접 확인한 사실과 제 의견을 구분함', 'none'
      )`,
      [threadId, commentId, responderId, requestId],
    );

    await db.query("DELETE FROM public.community_responder_requests WHERE id = $1", [requestId]);
    const answer = await db.query<{ responder_request_id: string }>(
      "SELECT responder_request_id FROM public.community_decision_answers",
    );
    expect(answer.rows[0]?.responder_request_id).toBe(requestId);
  });
});
