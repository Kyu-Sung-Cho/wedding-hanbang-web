BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.set_amora_core_criterion_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_criterion_id uuid,
  p_request_id uuid,
  p_value text,
  p_delete boolean
)
RETURNS jsonb
LANGUAGE plpgsql
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
  v_visibility text;
  v_latest public.decision_nodes%ROWTYPE;
  v_current_id uuid;
  v_replay public.decision_nodes%ROWTYPE;
  v_inserted_id uuid;
  v_inserted_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CORE_CRITERION_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_request_id IS NULL
     OR p_delete IS NULL
     OR (
       p_delete = false
       AND (
         p_value IS NULL
         OR char_length(btrim(p_value)) NOT BETWEEN 1 AND 120
         OR p_value IS DISTINCT FROM btrim(p_value)
       )
     )
     OR (
       p_delete = true
       AND (p_value IS NOT NULL OR p_expected_criterion_id IS NULL)
     ) THEN
    RAISE EXCEPTION 'AMORA_CORE_CRITERION_INVALID'
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
    RAISE EXCEPTION 'AMORA_CORE_CRITERION_SCOPE_CHANGED'
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
    RAISE EXCEPTION 'AMORA_CORE_CRITERION_SCOPE_CHANGED'
      USING ERRCODE = '42501';
  END IF;
  v_visibility := v_profile_role || '_private';

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-core-criterion:' || p_couple_id::text || ':' || p_recipient_user_id::text,
      0
    )
  );

  SELECT decision.* INTO v_replay
  FROM public.decision_nodes AS decision
  WHERE decision.couple_id = p_couple_id
    AND decision.visibility = v_visibility
    AND decision.source_actor_role = v_profile_role
    AND decision.source = 'manual'
    AND decision.source_ref_id = p_request_id
    AND COALESCE(decision.metadata, '{}'::jsonb) @> jsonb_build_object(
      'criterion_contract', 'amora_core_criterion_v1',
      'owner_user_id', p_recipient_user_id::text
    )
  ORDER BY decision.created_at DESC, decision.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF v_replay.chosen_value IS DISTINCT FROM jsonb_build_object('value', p_value)
       OR COALESCE(v_replay.metadata, '{}'::jsonb) ->> 'criterion_deleted'
          IS DISTINCT FROM p_delete::text THEN
      RAISE EXCEPTION 'AMORA_CORE_CRITERION_REQUEST_REUSED'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'version', 1,
      'deleted', p_delete,
      'criterionId', v_replay.id,
      'value', p_value,
      'updatedAt', v_replay.updated_at
    );
  END IF;

  SELECT decision.* INTO v_latest
  FROM public.decision_nodes AS decision
  WHERE decision.couple_id = p_couple_id
    AND decision.visibility = v_visibility
    AND decision.source_actor_role = v_profile_role
    AND decision.source = 'manual'
    AND decision.category = 'preference'
    AND decision.decision_type = 'considering'
    AND COALESCE(decision.metadata, '{}'::jsonb) @> jsonb_build_object(
      'criterion_contract', 'amora_core_criterion_v1',
      'owner_user_id', p_recipient_user_id::text
    )
  ORDER BY decision.created_at DESC, decision.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND AND COALESCE(v_latest.metadata, '{}'::jsonb) ->> 'criterion_deleted' IS DISTINCT FROM 'true' THEN
    v_current_id := v_latest.id;
  ELSE
    v_current_id := NULL;
  END IF;
  IF p_expected_criterion_id IS DISTINCT FROM v_current_id THEN
    RAISE EXCEPTION 'AMORA_CORE_CRITERION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.decision_nodes (
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    options_considered,
    reasoning,
    confidence,
    source,
    source_ref_id,
    metadata,
    visibility,
    source_actor_role,
    user_confirmed_at,
    created_at,
    updated_at
  ) VALUES (
    p_couple_id,
    'preference',
    'considering',
    CASE
      WHEN p_delete THEN '삭제한 결혼 준비 기준'
      ELSE '내가 꼭 지키고 싶은 결혼 준비 기준'
    END,
    jsonb_build_object('value', p_value),
    '[]'::jsonb,
    CASE
      WHEN p_delete THEN '사용자가 직접 삭제한 결혼 준비 기준'
      ELSE '사용자가 직접 확인한 결혼 준비 기준'
    END,
    1.00,
    'manual',
    p_request_id,
    jsonb_build_object(
      'criterion_contract', 'amora_core_criterion_v1',
      'criterion_version', 1,
      'owner_user_id', p_recipient_user_id::text,
      'explicit', true,
      'criterion_deleted', p_delete
    ),
    v_visibility,
    v_profile_role,
    v_now,
    v_now,
    v_now
  )
  RETURNING id, updated_at INTO v_inserted_id, v_inserted_at;

  RETURN jsonb_build_object(
    'version', 1,
    'deleted', p_delete,
    'criterionId', v_inserted_id,
    'value', p_value,
    'updatedAt', v_inserted_at
  );
END
$function$;

ALTER FUNCTION public.set_amora_core_criterion_v1(
  uuid, uuid, uuid, uuid, text, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_amora_core_criterion_v1(
  uuid, uuid, uuid, uuid, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_amora_core_criterion_v1(
  uuid, uuid, uuid, uuid, text, boolean
) TO service_role;

COMMIT;
