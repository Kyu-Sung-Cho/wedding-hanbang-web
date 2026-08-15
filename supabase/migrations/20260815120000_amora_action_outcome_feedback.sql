BEGIN;

DO $preconditions$
BEGIN
  IF to_regclass('public.amora_action_follow_up_outcomes_v2') IS NULL
     OR to_regclass('public.amora_actions') IS NULL
     OR to_regclass('public.amora_privacy_context_epochs') IS NULL THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_DEPENDENCY_MISSING';
  END IF;
  IF to_regprocedure(
    'public.amora_action_follow_up_digest_v2(public.amora_actions)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_DIGEST_MISSING';
  END IF;
END
$preconditions$;

CREATE OR REPLACE FUNCTION public.read_own_amora_action_outcome_feedback_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
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
  v_outcome public.amora_action_follow_up_outcomes_v2%ROWTYPE;
  v_action public.amora_actions%ROWTYPE;
  v_none jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_none := jsonb_build_object(
    'version', 1,
    'state', 'none',
    'recipientUserId', p_recipient_user_id,
    'coupleId', p_couple_id
  );

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_RECIPIENT_FORBIDDEN'
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
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT privacy.epoch
  INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS privacy
  WHERE privacy.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT outcome.*
  INTO v_outcome
  FROM public.amora_action_follow_up_outcomes_v2 AS outcome
  WHERE outcome.couple_id = p_couple_id
    AND outcome.recipient_user_id = p_recipient_user_id
    AND outcome.privacy_epoch = v_privacy_epoch
    AND outcome.recorded_at > v_now - interval '24 hours'
  ORDER BY outcome.recorded_at DESC, outcome.id DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN v_none;
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.amora_actions AS action
  WHERE action.id = v_outcome.action_id
    AND action.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR v_action.follow_up_revision IS DISTINCT FROM v_outcome.action_revision
     OR v_action.status IS DISTINCT FROM v_outcome.action_status
     OR (
       v_outcome.outcome = 'completed'
       AND (
         v_action.status <> 'done'
         OR v_outcome.action_revision <= v_outcome.source_revision
       )
     )
     OR (
       v_outcome.outcome IN ('blocked', 'changed', 'not_sure')
       AND (
         v_action.status <> 'open'
         OR v_outcome.action_revision IS DISTINCT FROM v_outcome.source_revision
         OR public.amora_action_follow_up_digest_v2(v_action)
            IS DISTINCT FROM v_outcome.source_digest
       )
     ) THEN
    RETURN v_none;
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'state', 'ready',
    'recipientUserId', p_recipient_user_id,
    'coupleId', p_couple_id,
    'feedback', jsonb_strip_nulls(jsonb_build_object(
      'outcomeId', v_outcome.id,
      'actionId', v_outcome.action_id,
      'actionTitle', v_action.title,
      'sourceRevision', v_outcome.source_revision,
      'actionRevision', v_outcome.action_revision,
      'actionStatus', v_outcome.action_status,
      'outcome', v_outcome.outcome,
      'blockerCode', v_outcome.blocker_code,
      'recordedAt', v_outcome.recorded_at,
      'validUntil', v_outcome.recorded_at + interval '24 hours'
    ))
  );
END
$function$;

ALTER FUNCTION public.read_own_amora_action_outcome_feedback_v1(
  uuid, uuid, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_own_amora_action_outcome_feedback_v1(
  uuid, uuid, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_own_amora_action_outcome_feedback_v1(
  uuid, uuid, bigint
) TO service_role;

COMMENT ON FUNCTION public.read_own_amora_action_outcome_feedback_v1(
  uuid, uuid, bigint
) IS
  'Reads one recent owner-private action outcome only while its couple, privacy epoch, action status, revision, and digest remain current.';

DO $postconditions$
BEGIN
  IF to_regprocedure(
    'public.read_own_amora_action_outcome_feedback_v1(uuid,uuid,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_RPC_MISSING';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.read_own_amora_action_outcome_feedback_v1(uuid,uuid,bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.read_own_amora_action_outcome_feedback_v1(uuid,uuid,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.read_own_amora_action_outcome_feedback_v1(uuid,uuid,bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_OUTCOME_FEEDBACK_RPC_ACL_INVALID';
  END IF;
END
$postconditions$;

COMMIT;
