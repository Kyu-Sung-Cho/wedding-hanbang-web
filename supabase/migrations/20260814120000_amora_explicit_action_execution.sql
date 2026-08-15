BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.amora_action_follow_up_cards_v2
  ADD COLUMN IF NOT EXISTS claim_mode text NOT NULL DEFAULT 'scheduled_follow_up';

ALTER TABLE public.amora_action_follow_up_cards_v2
  DROP CONSTRAINT IF EXISTS amora_action_follow_up_cards_v2_claim_mode_check;
ALTER TABLE public.amora_action_follow_up_cards_v2
  ADD CONSTRAINT amora_action_follow_up_cards_v2_claim_mode_check
    CHECK (claim_mode IN ('scheduled_follow_up', 'explicit_action')) NOT VALID;
ALTER TABLE public.amora_action_follow_up_cards_v2
  VALIDATE CONSTRAINT amora_action_follow_up_cards_v2_claim_mode_check;

CREATE OR REPLACE FUNCTION public.claim_amora_action_execution_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_action_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now AT TIME ZONE 'Asia/Seoul')::date;
  v_expires_at timestamptz :=
    ((v_now AT TIME ZONE 'Asia/Seoul')::date + 1)::timestamp
      AT TIME ZONE 'Asia/Seoul';
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_privacy_epoch bigint;
  v_action public.amora_actions%ROWTYPE;
  v_card public.amora_action_follow_up_cards_v2%ROWTYPE;
  v_digest text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_CLAIM_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_expected_privacy_epoch IS NULL OR p_expected_privacy_epoch < 1
     OR p_action_id IS NULL
     OR char_length(p_action_id) NOT BETWEEN 1 AND 200
     OR p_action_id !~ '^[0-9A-Za-z_-]+$' THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_CLAIM_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR (
    p_recipient_user_id IS DISTINCT FROM v_bride_id
    AND p_recipient_user_id IS DISTINCT FROM v_groom_id
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

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
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT epoch INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs
  WHERE couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'amora-today-one-daily-v1-v2:'
      || p_couple_id::text || ':'
      || p_recipient_user_id::text || ':'
      || v_today::text,
    0
  ));

  IF EXISTS (
    SELECT 1
    FROM public.amora_today_one_recipient_states AS v1
    WHERE v1.couple_id = p_couple_id
      AND v1.recipient_user_id = p_recipient_user_id
      AND v1.claimed_for_date = v_today
  ) THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'none', 'recipientUserId', p_recipient_user_id
    );
  END IF;

  SELECT card.* INTO v_card
  FROM public.amora_action_follow_up_cards_v2 AS card
  WHERE card.couple_id = p_couple_id
    AND card.recipient_user_id = p_recipient_user_id
    AND card.action_id = p_action_id
  ORDER BY card.source_revision DESC, card.created_at DESC, card.id
  LIMIT 1
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.amora_action_follow_up_cards_v2 AS daily
    WHERE daily.couple_id = p_couple_id
      AND daily.recipient_user_id = p_recipient_user_id
      AND daily.claimed_for_date = v_today
      AND (v_card.id IS NULL OR daily.id <> v_card.id)
  ) THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'daily_limit', 'recipientUserId', p_recipient_user_id
    );
  END IF;

  SELECT action.* INTO v_action
  FROM public.amora_actions AS action
  WHERE action.id = p_action_id
    AND action.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND OR v_action.status <> 'open' THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'none', 'recipientUserId', p_recipient_user_id
    );
  END IF;
  v_digest := public.amora_action_follow_up_digest_v2(v_action);

  IF v_card.id IS NOT NULL
     AND v_card.source_revision = v_action.follow_up_revision
     AND v_card.source_digest = v_digest
     AND v_card.privacy_epoch = v_privacy_epoch THEN
    IF v_card.state = 'consumed'
       OR (
         v_card.state = 'deferred'
         AND v_card.eligible_again_at IS NOT NULL
         AND v_card.eligible_again_at > v_now
       ) THEN
      RETURN jsonb_build_object(
        'version', 2, 'state', 'none', 'recipientUserId', p_recipient_user_id
      );
    END IF;
    IF v_card.state = 'ready'
       AND v_card.expires_at > v_now
       AND v_card.claim_mode = 'explicit_action' THEN
      RETURN public.amora_action_follow_up_card_response_v2(v_card, v_action);
    END IF;

    UPDATE public.amora_action_follow_up_cards_v2
    SET revision = revision + 1,
        claim_mode = 'explicit_action',
        claimed_for_date = v_today,
        outcome_idempotency_key = gen_random_uuid(),
        state = 'ready',
        eligible_again_at = NULL,
        expires_at = v_expires_at,
        created_at = v_now,
        consumed_at = NULL
    WHERE id = v_card.id
    RETURNING * INTO v_card;
    RETURN public.amora_action_follow_up_card_response_v2(v_card, v_action);
  END IF;

  IF v_card.id IS NOT NULL AND v_card.state = 'ready' THEN
    UPDATE public.amora_action_follow_up_cards_v2
    SET state = 'consumed', consumed_at = v_now, eligible_again_at = NULL
    WHERE id = v_card.id;
  END IF;

  INSERT INTO public.amora_action_follow_up_cards_v2(
    couple_id, recipient_user_id, action_id, source_revision, source_digest,
    privacy_epoch, claimed_for_date, claim_mode, expires_at
  ) VALUES (
    p_couple_id, p_recipient_user_id, v_action.id,
    v_action.follow_up_revision, v_digest, v_privacy_epoch, v_today,
    'explicit_action', v_expires_at
  )
  ON CONFLICT (recipient_user_id, action_id, source_revision) DO UPDATE
  SET revision = public.amora_action_follow_up_cards_v2.revision + 1,
      source_digest = EXCLUDED.source_digest,
      privacy_epoch = EXCLUDED.privacy_epoch,
      claimed_for_date = EXCLUDED.claimed_for_date,
      claim_mode = 'explicit_action',
      outcome_idempotency_key = gen_random_uuid(),
      state = 'ready',
      eligible_again_at = NULL,
      expires_at = EXCLUDED.expires_at,
      created_at = v_now,
      consumed_at = NULL
  WHERE public.amora_action_follow_up_cards_v2.state = 'deferred'
    AND public.amora_action_follow_up_cards_v2.eligible_again_at <= v_now
  RETURNING * INTO v_card;

  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'none', 'recipientUserId', p_recipient_user_id
    );
  END IF;
  RETURN public.amora_action_follow_up_card_response_v2(v_card, v_action);
END
$function$;

CREATE OR REPLACE FUNCTION public.record_amora_action_execution_outcome_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_card_id uuid,
  p_expected_card_revision bigint,
  p_expected_source_revision bigint,
  p_outcome text,
  p_blocker_code text,
  p_confirmed boolean,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_privacy_epoch bigint;
  v_card public.amora_action_follow_up_cards_v2%ROWTYPE;
  v_action public.amora_actions%ROWTYPE;
  v_saved public.amora_action_follow_up_outcomes_v2%ROWTYPE;
  v_request_digest text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_OUTCOME_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_card_id IS NULL
     OR p_expected_card_revision IS NULL OR p_expected_card_revision < 1
     OR p_expected_source_revision IS NULL OR p_expected_source_revision < 1
     OR p_idempotency_key IS NULL
     OR p_outcome NOT IN ('completed', 'blocked', 'changed', 'not_sure')
     OR (p_outcome IN ('completed', 'changed') AND p_confirmed IS DISTINCT FROM true)
     OR (p_outcome IN ('blocked', 'not_sure') AND p_confirmed IS DISTINCT FROM false)
     OR (p_outcome = 'blocked' AND p_blocker_code NOT IN (
       'time', 'partner_check', 'missing_info', 'other'
     ))
     OR (p_outcome <> 'blocked' AND p_blocker_code IS NOT NULL) THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_OUTCOME_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_request_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'cardId', p_card_id,
    'cardRevision', p_expected_card_revision,
    'sourceRevision', p_expected_source_revision,
    'outcome', p_outcome,
    'blockerCode', p_blocker_code,
    'confirmed', p_confirmed
  )::text, 'UTF8'), 'sha256'), 'hex');

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR (
    p_recipient_user_id IS DISTINCT FROM v_bride_id
    AND p_recipient_user_id IS DISTINCT FROM v_groom_id
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id, profile.role
  INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
  FOR SHARE;
  IF NOT FOUND OR v_profile_couple_id IS DISTINCT FROM p_couple_id OR NOT (
    (v_profile_role = 'bride' AND v_bride_id = p_recipient_user_id)
    OR (v_profile_role = 'groom' AND v_groom_id = p_recipient_user_id)
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT epoch INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs
  WHERE couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT saved.* INTO v_saved
  FROM public.amora_action_follow_up_outcomes_v2 AS saved
  WHERE saved.recipient_user_id = p_recipient_user_id
    AND saved.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_saved.couple_id IS DISTINCT FROM p_couple_id
       OR v_saved.privacy_epoch IS DISTINCT FROM v_privacy_epoch
       OR v_saved.request_digest IS DISTINCT FROM v_request_digest THEN
      IF v_saved.privacy_epoch IS DISTINCT FROM v_privacy_epoch THEN
        RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_PRIVACY_STALE'
          USING ERRCODE = '40001';
      END IF;
      RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.amora_action_follow_up_receipt_response_v2(v_saved);
  END IF;

  SELECT card.* INTO v_card
  FROM public.amora_action_follow_up_cards_v2 AS card
  WHERE card.id = p_card_id
    AND card.couple_id = p_couple_id
    AND card.recipient_user_id = p_recipient_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_card.claim_mode <> 'explicit_action' THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_CARD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT saved.* INTO v_saved
  FROM public.amora_action_follow_up_outcomes_v2 AS saved
  WHERE saved.recipient_user_id = p_recipient_user_id
    AND saved.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_saved.couple_id IS DISTINCT FROM p_couple_id
       OR v_saved.privacy_epoch IS DISTINCT FROM v_privacy_epoch
       OR v_saved.request_digest IS DISTINCT FROM v_request_digest THEN
      RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.amora_action_follow_up_receipt_response_v2(v_saved);
  END IF;

  IF v_card.state <> 'ready'
     OR v_card.expires_at <= v_now
     OR v_card.privacy_epoch IS DISTINCT FROM v_privacy_epoch
     OR v_card.revision IS DISTINCT FROM p_expected_card_revision
     OR v_card.source_revision IS DISTINCT FROM p_expected_source_revision
     OR v_card.outcome_idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_CARD_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT action.* INTO v_action
  FROM public.amora_actions AS action
  WHERE action.id = v_card.action_id
    AND action.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_action.status <> 'open'
     OR v_action.follow_up_revision IS DISTINCT FROM v_card.source_revision
     OR public.amora_action_follow_up_digest_v2(v_action)
        IS DISTINCT FROM v_card.source_digest THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_SOURCE_STALE'
      USING ERRCODE = '40001';
  END IF;

  IF p_outcome = 'completed' THEN
    UPDATE public.amora_actions
    SET status = 'done',
        completed_at = COALESCE(completed_at, v_now),
        dismissed_at = NULL
    WHERE id = v_action.id
      AND couple_id = p_couple_id
      AND status = 'open'
      AND follow_up_revision = v_card.source_revision
    RETURNING * INTO v_action;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_SOURCE_STALE'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.amora_action_follow_up_cards_v2
  SET state = CASE
        WHEN p_outcome IN ('blocked', 'changed', 'not_sure') THEN 'deferred'
        ELSE 'consumed'
      END,
      eligible_again_at = CASE
        WHEN p_outcome IN ('blocked', 'changed', 'not_sure') THEN v_now + interval '24 hours'
        ELSE NULL
      END,
      consumed_at = v_now
  WHERE id = v_card.id;

  INSERT INTO public.amora_action_follow_up_outcomes_v2(
    couple_id, recipient_user_id, card_id, action_id, card_revision,
    source_revision, source_digest, privacy_epoch, outcome, blocker_code, action_status,
    action_revision, idempotency_key, request_digest, recorded_at
  ) VALUES (
    p_couple_id, p_recipient_user_id, v_card.id, v_action.id, v_card.revision,
    v_card.source_revision, v_card.source_digest, v_privacy_epoch, p_outcome, p_blocker_code,
    v_action.status, v_action.follow_up_revision, p_idempotency_key,
    v_request_digest, v_now
  )
  RETURNING * INTO v_saved;

  RETURN public.amora_action_follow_up_receipt_response_v2(v_saved);
END
$function$;

ALTER FUNCTION public.claim_amora_action_execution_v1(uuid, uuid, bigint, text)
  OWNER TO postgres;
ALTER FUNCTION public.record_amora_action_execution_outcome_v1(
  uuid, uuid, bigint, uuid, bigint, bigint, text, text, boolean, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.claim_amora_action_execution_v1(
  uuid, uuid, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_amora_action_execution_outcome_v1(
  uuid, uuid, bigint, uuid, bigint, bigint, text, text, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_action_execution_v1(
  uuid, uuid, bigint, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_amora_action_execution_outcome_v1(
  uuid, uuid, bigint, uuid, bigint, bigint, text, text, boolean, uuid
) TO service_role;

COMMENT ON COLUMN public.amora_action_follow_up_cards_v2.claim_mode IS
  'scheduled_follow_up respects proactive-care preferences; explicit_action is created only after the member opens the exact canonical home action.';
COMMENT ON FUNCTION public.claim_amora_action_execution_v1(uuid, uuid, bigint, text) IS
  'Claims the exact open action selected on home without changing proactive-care consent.';
COMMENT ON FUNCTION public.record_amora_action_execution_outcome_v1(
  uuid, uuid, bigint, uuid, bigint, bigint, text, text, boolean, uuid
) IS
  'Records a bounded explicit home-action outcome and returns a canonical recipient-private receipt.';

DO $postconditions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.amora_action_follow_up_cards_v2'::regclass
      AND attname = 'claim_mode'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_CLAIM_MODE_MISSING';
  END IF;
  IF to_regprocedure(
    'public.claim_amora_action_execution_v1(uuid,uuid,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_CLAIM_RPC_MISSING';
  END IF;
  IF to_regprocedure(
    'public.record_amora_action_execution_outcome_v1(uuid,uuid,bigint,uuid,bigint,bigint,text,text,boolean,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_ACTION_EXECUTION_OUTCOME_RPC_MISSING';
  END IF;
END
$postconditions$;

COMMIT;
