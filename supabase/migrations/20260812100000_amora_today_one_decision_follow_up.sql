BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('public.amora_today_one_signals') IS NULL
     OR to_regclass('public.decision_nodes') IS NULL
     OR to_regclass('public.couple_plan_change_requests') IS NULL
     OR to_regclass('public.couple_plan_change_acceptances') IS NULL
     OR to_regclass('public.amora_privacy_context_epochs') IS NULL
     OR to_regprocedure(
       'public.amora_today_one_presentation_is_valid(jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.compile_amora_today_one_card(uuid,uuid,text,text,bigint,integer,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_FOLLOW_UP_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

-- A decision follow-up is still an in-app, owner-controlled TodayOne card.
-- It can only navigate back to the exact bounded product surface represented
-- by the confirmed decision; it gains no mutation or outbound privilege.
CREATE OR REPLACE FUNCTION public.amora_today_one_presentation_is_valid(
  p_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_kind text;
  v_next_action jsonb;
  v_choices jsonb;
  v_href text;
  v_label text;
BEGIN
  IF p_value IS NULL
     OR jsonb_typeof(p_value) <> 'object'
     OR pg_column_size(p_value) > 8192
     OR NOT p_value ?& ARRAY[
       'kind', 'whyNow', 'confirmed', 'unknown', 'nextAction', 'impact', 'choices'
     ]
     OR (SELECT count(*) FROM jsonb_object_keys(p_value)) <> 7
     OR p_value->>'kind' NOT IN (
       'schedule_moment', 'budget_guardrail', 'decision_follow_up'
     )
     OR NOT public.amora_today_one_text_is_safe(p_value->>'whyNow', 1, 240)
     OR NOT public.amora_today_one_text_is_safe(p_value->>'impact', 1, 180)
     OR jsonb_typeof(p_value->'confirmed') <> 'array'
     OR jsonb_array_length(p_value->'confirmed') NOT BETWEEN 1 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_value->'confirmed') AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
          OR NOT public.amora_today_one_text_is_safe(item.value #>> '{}', 1, 180)
     )
     OR jsonb_typeof(p_value->'unknown') <> 'array'
     OR jsonb_array_length(p_value->'unknown') NOT BETWEEN 0 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_value->'unknown') AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
          OR NOT public.amora_today_one_text_is_safe(item.value #>> '{}', 1, 180)
     ) THEN
    RETURN false;
  END IF;

  v_kind := p_value->>'kind';
  v_next_action := p_value->'nextAction';
  IF jsonb_typeof(v_next_action) <> 'object'
     OR NOT v_next_action ?& ARRAY['label', 'href']
     OR (SELECT count(*) FROM jsonb_object_keys(v_next_action)) <> 2
     OR NOT public.amora_today_one_text_is_safe(v_next_action->>'label', 1, 80)
     OR NOT public.amora_today_one_text_is_safe(v_next_action->>'href', 1, 240) THEN
    RETURN false;
  END IF;

  v_label := v_next_action->>'label';
  v_href := v_next_action->>'href';
  IF left(v_href, 1) <> '/'
     OR left(v_href, 2) = '//'
     OR position(E'\\' IN v_href) > 0
     OR (v_kind = 'schedule_moment' AND (
       v_label <> '일정 열기' OR v_href <> '/schedule'
     ))
     OR (v_kind = 'budget_guardrail' AND (
       v_label <> '예산 열기' OR v_href <> '/budget'
     ))
     OR (v_kind = 'decision_follow_up' AND NOT (
       (v_label = '예산 열기' AND v_href = '/budget')
       OR (v_label = '일정 열기' AND v_href = '/schedule')
       OR (v_label = '준비 현황 열기' AND v_href = '/dashboard')
     )) THEN
    RETURN false;
  END IF;

  v_choices := p_value->'choices';
  IF jsonb_typeof(v_choices) <> 'array'
     OR jsonb_array_length(v_choices) NOT BETWEEN 2 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_choices) AS choice(value)
       WHERE jsonb_typeof(choice.value) <> 'object'
          OR NOT choice.value ?& ARRAY['action', 'label']
          OR (SELECT count(*) FROM jsonb_object_keys(choice.value)) <> 2
          OR choice.value->>'action' NOT IN (
            'open_source', 'snooze', 'dismiss', 'mute_source'
          )
          OR NOT public.amora_today_one_text_is_safe(
            choice.value->>'label', 1, 40
          )
     )
     OR (
       SELECT count(DISTINCT choice.value->>'action')
       FROM jsonb_array_elements(v_choices) AS choice(value)
     ) <> jsonb_array_length(v_choices) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$function$;

-- The route may discover a candidate optimistically, but only this wrapper
-- turns it into a card. It keeps the current roster, privacy epoch, immutable
-- approval receipt, decision node, and current journey projection under one
-- transaction fence. Later unrelated journey revisions remain eligible; a
-- reversal of the fields/events that this exact decision applied does not.
CREATE OR REPLACE FUNCTION public.compile_amora_decision_follow_up_card(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_decision_id uuid,
  p_expected_privacy_epoch bigint,
  p_state_digest text,
  p_source_revision bigint,
  p_priority integer,
  p_presentation jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := public.amora_today_one_clock();
  v_today date := (v_now AT TIME ZONE 'Asia/Seoul')::date;
  v_bride_id uuid;
  v_groom_id uuid;
  v_member_count integer;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_privacy_epoch bigint;
  v_journey public.wedding_journeys%ROWTYPE;
  v_decision public.decision_nodes%ROWTYPE;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_acceptance_count integer;
  v_acceptance_ids uuid[];
  v_acceptances jsonb;
  v_expected_presentation jsonb;
  v_next_action jsonb;
  v_source_key text;
  v_current_progress jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_COMPILE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_decision_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_source_revision IS NULL
     OR p_source_revision NOT BETWEEN 0 AND 9007199254740991
     OR p_priority IS DISTINCT FROM 80 THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_CONTEXT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Match compile_amora_today_one_card's lock order before taking the extra
  -- privacy/receipt locks, so concurrent roster changes cannot deadlock this
  -- wrapper into accepting a mixed snapshot.
  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR (v_bride_id IS NULL AND v_groom_id IS NULL)
     OR v_bride_id IS NOT DISTINCT FROM v_groom_id
     OR (
       p_recipient_user_id IS DISTINCT FROM v_bride_id
       AND p_recipient_user_id IS DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  v_member_count :=
    (CASE WHEN v_bride_id IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN v_groom_id IS NULL THEN 0 ELSE 1 END);

  SELECT profile.couple_id, profile.role
  INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
  FOR SHARE;
  IF NOT FOUND
     OR v_profile_couple_id IS DISTINCT FROM p_couple_id
     OR NOT (
       (v_profile_role = 'bride' AND v_bride_id = p_recipient_user_id)
       OR (v_profile_role = 'groom' AND v_groom_id = p_recipient_user_id)
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT journey.* INTO v_journey
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_journey.state_revision IS DISTINCT FROM p_source_revision THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'source_stale'
    );
  END IF;

  SELECT privacy.epoch INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS privacy
  WHERE privacy.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_EPOCH_MISSING';
  END IF;
  IF v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_PRIVACY_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT decision.* INTO v_decision
  FROM public.decision_nodes AS decision
  WHERE decision.id = p_decision_id
    AND decision.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR v_decision.visibility <> 'shared'
     OR v_decision.decision_type NOT IN ('decided', 'scheduled')
     OR v_decision.superseded_at IS NOT NULL
     OR v_decision.user_confirmed_at IS NULL
     OR v_decision.decided_at IS NULL
     OR v_decision.user_confirmed_at > v_decision.decided_at
     OR v_decision.decided_at > v_now - interval '24 hours'
     OR v_decision.source_actor_role NOT IN ('bride', 'groom')
     OR (v_decision.source_actor_role = 'bride' AND v_bride_id IS NULL)
     OR (v_decision.source_actor_role = 'groom' AND v_groom_id IS NULL)
     OR NOT public.amora_today_one_text_is_safe(v_decision.title, 1, 120)
     OR v_decision.metadata ->> 'origin' <> 'couple_plan_change_request'
     OR v_decision.metadata ->> 'requestId' IS DISTINCT FROM
        v_decision.source_ref_id::text
     OR COALESCE((v_decision.metadata ->> 'legacyReceiptOnly')::boolean, false)
     OR (v_decision.metadata ->> 'appliedRevision')::bigint >
        v_journey.state_revision THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT request.* INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = v_decision.source_ref_id
    AND request.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR v_request.status <> 'applied'
     OR v_request.applied_revision IS DISTINCT FROM v_request.base_revision + 1
     OR v_request.applied_revision IS DISTINCT FROM
        (v_decision.metadata ->> 'appliedRevision')::bigint
     OR v_request.base_revision IS DISTINCT FROM
        (v_decision.metadata ->> 'expectedRevision')::bigint
     OR v_request.applied_at IS DISTINCT FROM v_decision.decided_at
     OR v_request.actor_accepted_at IS DISTINCT FROM
        v_decision.user_confirmed_at
     OR v_request.summary IS DISTINCT FROM v_decision.title
     OR v_request.surface_href IS DISTINCT FROM
        v_decision.metadata ->> 'surfaceHref'
     OR v_request.change_digest IS DISTINCT FROM
        v_decision.metadata ->> 'changeDigest'
     OR v_request.roster_fingerprint IS DISTINCT FROM
        v_decision.metadata ->> 'rosterFingerprint'
     OR v_request.required_count IS DISTINCT FROM v_member_count
     OR v_request.roster_fingerprint IS DISTINCT FROM md5(
       COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
     )
     OR (v_decision.source_actor_role = 'bride'
       AND v_request.actor_user_id IS DISTINCT FROM v_bride_id)
     OR (v_decision.source_actor_role = 'groom'
       AND v_request.actor_user_id IS DISTINCT FROM v_groom_id)
     OR (v_request.surface_href = '/schedule' AND (
       v_decision.source <> 'schedule'
       OR v_decision.decision_type <> 'scheduled'
     ))
     OR (v_request.surface_href <> '/schedule' AND (
       v_decision.source <> 'manual'
       OR v_decision.decision_type <> 'decided'
     )) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = v_request.id
  ORDER BY acceptance.user_id
  FOR SHARE;
  SELECT count(*)::integer,
         array_agg(acceptance.user_id ORDER BY acceptance.user_id),
         jsonb_agg(
           jsonb_build_object(
             'userId', acceptance.user_id,
             'acceptedAt', acceptance.accepted_at
           ) ORDER BY acceptance.user_id
         )
  INTO v_acceptance_count, v_acceptance_ids, v_acceptances
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = v_request.id
    AND acceptance.couple_id = p_couple_id
    AND acceptance.change_digest = v_request.change_digest
    AND acceptance.roster_fingerprint = v_request.roster_fingerprint;
  IF v_acceptance_count IS DISTINCT FROM v_member_count
     OR v_acceptance_ids IS DISTINCT FROM ARRAY(
       SELECT member_id
       FROM unnest(ARRAY[v_bride_id, v_groom_id]) AS member(member_id)
       WHERE member_id IS NOT NULL
       ORDER BY member_id
     )
     OR v_acceptances IS DISTINCT FROM v_decision.metadata -> 'acceptances'
     OR (v_decision.metadata ->> 'requiredCount')::integer IS DISTINCT FROM
        v_member_count THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_ACCEPTANCES_INVALID'
      USING ERRCODE = '55000';
  END IF;

  v_current_progress := COALESCE(v_journey.progress, '{}'::jsonb);
  IF v_request.surface_href = '/schedule' THEN
    IF v_request.schedule_after_event IS NULL
       OR jsonb_typeof(v_current_progress -> '__events') <> 'array'
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(v_current_progress -> '__events') AS event(value)
         WHERE event.value IS NOT DISTINCT FROM v_request.schedule_after_event
       ) THEN
      RETURN public.amora_today_one_build_response(
        p_recipient_user_id, v_today, 'none'
      );
    END IF;
  ELSIF (
    (v_request.changes ? 'wedding_date' AND
      CASE WHEN v_journey.wedding_date IS NULL THEN 'null'::jsonb
        ELSE to_jsonb(v_journey.wedding_date) END
      IS DISTINCT FROM v_request.changes -> 'wedding_date')
    OR (v_request.changes ? 'venue' AND
      CASE WHEN v_journey.venue IS NULL THEN 'null'::jsonb
        ELSE to_jsonb(v_journey.venue) END
      IS DISTINCT FROM v_request.changes -> 'venue')
    OR (v_request.changes ? 'total_budget' AND
      CASE WHEN v_journey.total_budget IS NULL THEN 'null'::jsonb
        ELSE to_jsonb(v_journey.total_budget) END
      IS DISTINCT FROM v_request.changes -> 'total_budget')
    OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(
        COALESCE(v_request.changes -> 'progress_patch', '{}'::jsonb)
      ) AS patched(key)
      WHERE v_current_progress -> patched.key IS DISTINCT FROM
        v_request.changes #> ARRAY['progress_patch', patched.key]
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        COALESCE(v_request.changes -> 'progress_remove_keys', '[]'::jsonb)
      ) AS removed(key)
      WHERE v_current_progress ? removed.key
    )
  ) THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'none'
    );
  END IF;

  v_next_action := CASE v_request.surface_href
    WHEN '/budget' THEN jsonb_build_object('label', '예산 열기', 'href', '/budget')
    WHEN '/schedule' THEN jsonb_build_object('label', '일정 열기', 'href', '/schedule')
    ELSE jsonb_build_object('label', '준비 현황 열기', 'href', '/dashboard')
  END;
  v_expected_presentation := jsonb_build_object(
    'kind', 'decision_follow_up',
    'whyNow', '직접 확인한 결정이 반영된 뒤 하루가 지났어요. 지금도 이대로 진행할지 확인해 보세요.',
    'confirmed', jsonb_build_array('결정: ' || v_decision.title),
    'unknown', '[]'::jsonb,
    'nextAction', v_next_action,
    'impact', '확인만 하며 예산·일정·체크리스트를 자동으로 바꾸지 않아요.',
    'choices', jsonb_build_array(
      jsonb_build_object('action', 'open_source', 'label', v_next_action ->> 'label'),
      jsonb_build_object('action', 'snooze', 'label', '나중에'),
      jsonb_build_object('action', 'dismiss', 'label', '오늘 닫기'),
      jsonb_build_object('action', 'mute_source', 'label', '내용이 바뀔 때까지 숨기기')
    )
  );
  IF p_presentation IS DISTINCT FROM v_expected_presentation THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_PRESENTATION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_source_key := 'decision:' || p_decision_id::text;
  RETURN public.compile_amora_today_one_card(
    p_couple_id,
    p_recipient_user_id,
    v_source_key,
    p_state_digest,
    p_source_revision,
    p_priority,
    p_presentation
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_RECEIPT_INVALID'
      USING ERRCODE = '55000';
END
$function$;

ALTER TABLE public.amora_today_one_signals
  DROP CONSTRAINT IF EXISTS amora_today_one_signals_kind_presentation_check;
ALTER TABLE public.amora_today_one_signals
  DROP CONSTRAINT IF EXISTS amora_today_one_signals_kind_check;
ALTER TABLE public.amora_today_one_signals
  ADD CONSTRAINT amora_today_one_signals_kind_check
    CHECK (kind IN (
      'schedule_moment', 'budget_guardrail', 'decision_follow_up'
    )) NOT VALID;
ALTER TABLE public.amora_today_one_signals
  ADD CONSTRAINT amora_today_one_signals_kind_presentation_check
    CHECK (kind = presentation->>'kind') NOT VALID;
ALTER TABLE public.amora_today_one_signals
  VALIDATE CONSTRAINT amora_today_one_signals_kind_check;
ALTER TABLE public.amora_today_one_signals
  VALIDATE CONSTRAINT amora_today_one_signals_kind_presentation_check;

ALTER FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.compile_amora_decision_follow_up_card(
  uuid, uuid, uuid, bigint, text, bigint, integer, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.compile_amora_decision_follow_up_card(
  uuid, uuid, uuid, bigint, text, bigint, integer, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compile_amora_decision_follow_up_card(
  uuid, uuid, uuid, bigint, text, bigint, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION public.amora_today_one_presentation_is_valid(jsonb) IS
  'Exact TodayOne schedule, explicit budget guardrail, or confirmed-decision follow-up presentation validator.';
COMMENT ON FUNCTION public.compile_amora_decision_follow_up_card(
  uuid, uuid, uuid, bigint, text, bigint, integer, jsonb
) IS
  'Service-only atomic compiler for a current-roster, privacy-fenced, still-applied explicit shared decision receipt.';
COMMENT ON TABLE public.amora_today_one_signals IS
  'Latest recipient-scoped, source-revision-bound in-app schedule, budget, or confirmed-decision evidence. No outbound delivery.';

DO $postconditions$
DECLARE
  v_kind_definition text;
BEGIN
  SELECT pg_get_constraintdef(constraint_row.oid)
  INTO v_kind_definition
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.amora_today_one_signals'::regclass
    AND constraint_row.conname = 'amora_today_one_signals_kind_check'
    AND constraint_row.convalidated;

  IF v_kind_definition IS NULL
     OR position('schedule_moment' IN v_kind_definition) = 0
     OR position('budget_guardrail' IN v_kind_definition) = 0
     OR position('decision_follow_up' IN v_kind_definition) = 0
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.amora_today_one_signals'::regclass
         AND constraint_row.conname = 'amora_today_one_signals_kind_presentation_check'
         AND constraint_row.convalidated
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_FOLLOW_UP_POSTCONDITION_FAILED';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.amora_today_one_presentation_is_valid(jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.amora_today_one_presentation_is_valid(jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_FOLLOW_UP_VALIDATOR_ACL_FAILED';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.compile_amora_decision_follow_up_card(uuid,uuid,uuid,bigint,text,bigint,integer,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.compile_amora_decision_follow_up_card(uuid,uuid,uuid,bigint,text,bigint,integer,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DECISION_FOLLOW_UP_COMPILER_ACL_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
