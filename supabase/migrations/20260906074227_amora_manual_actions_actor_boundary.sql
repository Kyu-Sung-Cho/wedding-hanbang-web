-- 수동 할 일 변경도 행위자 확인과 쓰기를 같은 트랜잭션에서 실행한다.
-- AI 승인/감사 RPC는 유지하며, legacy 배열 쓰기는 기존 revision CAS를 보존한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.lock_own_amora_action_couple(p_couple_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_profile_couple uuid;
  v_role text;
  v_bride uuid;
  v_groom uuid;
BEGIN
  IF v_actor IS NULL OR p_couple_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_ACTION_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT couple_id, role INTO v_profile_couple, v_role
  FROM public.profiles WHERE id = v_actor FOR NO KEY UPDATE;
  IF NOT FOUND OR v_profile_couple IS DISTINCT FROM p_couple_id THEN
    RAISE EXCEPTION 'AMORA_ACTION_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  -- 프로필 -> 커플 -> 대상 행. 조회 후 unlink/role/roster 변경이 끼지 못한다.
  SELECT bride_id, groom_id INTO v_bride, v_groom
  FROM public.couples WHERE id = p_couple_id FOR SHARE;
  IF NOT FOUND OR NOT COALESCE((
    (v_role = 'bride' AND v_bride = v_actor AND v_groom IS DISTINCT FROM v_actor)
    OR (v_role = 'groom' AND v_groom = v_actor AND v_bride IS DISTINCT FROM v_actor)
  ), false) THEN
    RAISE EXCEPTION 'AMORA_ACTION_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE FUNCTION public.validate_manual_amora_action_values(p_values jsonb, p_create boolean)
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE v_key text; v_limit integer;
BEGIN
  IF p_values IS NULL OR pg_catalog.jsonb_typeof(p_values) <> 'object'
     OR p_values = '{}'::jsonb OR pg_catalog.octet_length(p_values::text) > 32768 THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_values) LOOP
    IF v_key NOT IN ('title','description','due_date','category_key','priority','status','href')
       AND NOT (p_create AND v_key = 'source') THEN
      RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
    END IF;
    IF v_key IN ('priority','status','source','title')
       AND pg_catalog.jsonb_typeof(p_values -> v_key) <> 'string' THEN
      RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.jsonb_typeof(p_values -> v_key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
    END IF;
    v_limit := CASE v_key WHEN 'title' THEN 120 WHEN 'description' THEN 500
      WHEN 'due_date' THEN 40 WHEN 'category_key' THEN 80 WHEN 'href' THEN 180 ELSE 20 END;
    IF pg_catalog.char_length(p_values ->> v_key) > v_limit THEN
      RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (p_create AND NOT (p_values ? 'title'))
     OR (p_values ? 'title' AND pg_catalog.btrim(p_values ->> 'title') = '')
     OR (p_values ? 'status' AND p_values ->> 'status' NOT IN ('open','done','dismissed'))
     OR (p_values ? 'priority' AND p_values ->> 'priority' NOT IN ('high','medium','low'))
     OR (p_values ? 'source' AND p_values ->> 'source' NOT IN ('chat','quote','schedule','budget','guardrail','manual'))
     OR (p_values ->> 'href' IS NOT NULL AND (
       p_values ->> 'href' NOT LIKE '/%' OR p_values ->> 'href' LIKE '//%'
     )) THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE FUNCTION public.mutate_own_amora_action(
  p_couple_id uuid, p_action_id text, p_operation text, p_values jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.lock_own_amora_action_couple(p_couple_id);
  IF p_action_id IS NULL OR p_action_id !~ '^[a-zA-Z0-9_-]{4,120}$'
     OR p_operation IS NULL OR p_operation NOT IN ('create','update') THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM public.validate_manual_amora_action_values(p_values, p_operation = 'create');
  IF p_operation = 'create' THEN
    INSERT INTO public.amora_actions AS action (
      id, couple_id, title, description, due_date, category_key,
      priority, status, source, href, created_by
    ) VALUES (
      p_action_id, p_couple_id, pg_catalog.btrim(p_values ->> 'title'),
      p_values ->> 'description', p_values ->> 'due_date', p_values ->> 'category_key',
      COALESCE(p_values ->> 'priority','medium'), COALESCE(p_values ->> 'status','open'),
      COALESCE(p_values ->> 'source','manual'), p_values ->> 'href', auth.uid()
    ) RETURNING pg_catalog.to_jsonb(action) INTO v_result;
  ELSE
    UPDATE public.amora_actions AS action SET
      title = CASE WHEN p_values ? 'title' THEN pg_catalog.btrim(p_values ->> 'title') ELSE action.title END,
      description = CASE WHEN p_values ? 'description' THEN p_values ->> 'description' ELSE action.description END,
      due_date = CASE WHEN p_values ? 'due_date' THEN p_values ->> 'due_date' ELSE action.due_date END,
      category_key = CASE WHEN p_values ? 'category_key' THEN p_values ->> 'category_key' ELSE action.category_key END,
      priority = COALESCE(p_values ->> 'priority', action.priority),
      status = COALESCE(p_values ->> 'status', action.status),
      href = CASE WHEN p_values ? 'href' THEN p_values ->> 'href' ELSE action.href END
    WHERE action.id = p_action_id AND action.couple_id = p_couple_id
    RETURNING pg_catalog.to_jsonb(action) INTO v_result;
  END IF;
  RETURN v_result;
END;
$function$;

CREATE FUNCTION public.update_own_legacy_amora_action(
  p_couple_id uuid, p_journey_id uuid, p_action_id text,
  p_expected_revision bigint, p_values jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE
  v_progress jsonb; v_revision bigint; v_actions jsonb; v_current jsonb;
  v_updated jsonb; v_index integer; v_entry record; v_result jsonb;
BEGIN
  PERFORM public.lock_own_amora_action_couple(p_couple_id);
  IF p_action_id IS NULL OR p_action_id !~ '^[a-zA-Z0-9_-]{4,120}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM public.validate_manual_amora_action_values(p_values, false);
  SELECT progress, state_revision INTO v_progress, v_revision
  FROM public.wedding_journeys
  WHERE id = p_journey_id AND couple_id = p_couple_id FOR UPDATE;
  IF NOT FOUND OR v_revision IS DISTINCT FROM p_expected_revision THEN RETURN NULL; END IF;
  IF pg_catalog.jsonb_typeof(v_progress) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  v_actions := v_progress -> '__amora_actions';
  IF pg_catalog.jsonb_typeof(v_actions) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  SELECT value, (ordinality - 1)::integer INTO v_current, v_index
  FROM pg_catalog.jsonb_array_elements(v_actions) WITH ORDINALITY
  WHERE value ->> 'id' = p_action_id AND pg_catalog.jsonb_typeof(value -> 'title') = 'string'
  ORDER BY ordinality LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_updated := v_current;
  FOR v_entry IN SELECT key, value FROM pg_catalog.jsonb_each(p_values) LOOP
    v_updated := pg_catalog.jsonb_set(v_updated, ARRAY[CASE v_entry.key
      WHEN 'due_date' THEN 'dueDate' WHEN 'category_key' THEN 'categoryKey' ELSE v_entry.key END], v_entry.value);
  END LOOP;
  v_updated := v_updated || pg_catalog.jsonb_build_object('updatedAt', pg_catalog.clock_timestamp());
  IF p_values ->> 'status' = 'done' AND v_current ->> 'status' IS DISTINCT FROM 'done' THEN
    v_updated := v_updated || pg_catalog.jsonb_build_object('completedAt', pg_catalog.clock_timestamp());
  ELSIF p_values ? 'status' AND p_values ->> 'status' <> 'done' THEN
    v_updated := v_updated - 'completedAt';
  END IF;
  UPDATE public.wedding_journeys AS journey SET progress = pg_catalog.jsonb_set(
    v_progress, ARRAY['__amora_actions', v_index::text], v_updated
  )
  WHERE journey.id = p_journey_id AND journey.couple_id = p_couple_id
    AND journey.state_revision = p_expected_revision
  RETURNING pg_catalog.jsonb_build_object('progress', journey.progress, 'state_revision', journey.state_revision)
  INTO v_result;
  IF v_result IS NOT NULL AND (v_result ->> 'state_revision')::bigint IS DISTINCT FROM p_expected_revision + 1 THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.lock_own_amora_action_couple(uuid) OWNER TO postgres;
ALTER FUNCTION public.validate_manual_amora_action_values(jsonb, boolean) OWNER TO postgres;
ALTER FUNCTION public.mutate_own_amora_action(uuid, text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.update_own_legacy_amora_action(uuid, uuid, text, bigint, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lock_own_amora_action_couple(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_manual_amora_action_values(jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mutate_own_amora_action(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_own_legacy_amora_action(uuid, uuid, text, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_own_amora_action(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_legacy_amora_action(uuid, uuid, text, bigint, jsonb) TO authenticated;
COMMIT;
