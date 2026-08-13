BEGIN;

CREATE OR REPLACE FUNCTION public.couple_plan_checklist_profile_is_valid(
  p_profile jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_version text;
  v_answer_keys text[];
  v_item jsonb;
  v_seen jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
     OR p_profile - ARRAY[
       'version', 'reviewedAt', 'answers', 'autoExcludedItemIds'
     ]::text[] <> '{}'::jsonb
     OR jsonb_typeof(p_profile -> 'version') IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;

  v_version := p_profile ->> 'version';
  IF v_version NOT IN ('1', '2') THEN
    RETURN false;
  END IF;
  v_answer_keys := CASE v_version
    WHEN '1' THEN ARRAY[
      'ceremony', 'legalMarriage', 'travel', 'housing',
      'internationalMarriage', 'religiousCeremony', 'remarriage',
      'childrenParticipating', 'accessibilitySupport', 'healthSupport',
      'petParticipation', 'familyTradition'
    ]::text[]
    ELSE ARRAY[
      'ceremony', 'legalMarriage', 'travel', 'housing', 'gathering',
      'internationalMarriage', 'religiousCeremony', 'remarriage',
      'childrenParticipating', 'accessibilitySupport', 'healthSupport',
      'petParticipation', 'familyTradition'
    ]::text[]
  END;

  IF jsonb_typeof(p_profile -> 'reviewedAt') IS DISTINCT FROM 'string'
     OR char_length(p_profile ->> 'reviewedAt') NOT BETWEEN 20 AND 40
     OR public.couple_plan_change_has_unsafe_display_text(
       p_profile ->> 'reviewedAt'
     )
     OR p_profile ->> 'reviewedAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
     OR jsonb_typeof(p_profile -> 'answers') IS DISTINCT FROM 'object'
     OR (p_profile -> 'answers') - v_answer_keys <> '{}'::jsonb
     OR NOT (p_profile -> 'answers' ?& v_answer_keys)
     OR p_profile #>> '{answers,ceremony}' NOT IN (
       'yes', 'no', 'undecided'
     )
     OR p_profile #>> '{answers,legalMarriage}' NOT IN (
       'yes', 'no', 'undecided'
     )
     OR p_profile #>> '{answers,travel}' NOT IN (
       'domestic', 'international', 'none', 'undecided'
     )
     OR p_profile #>> '{answers,housing}' NOT IN (
       'rent', 'buy', 'other', 'undecided'
     )
     OR (
       v_version = '2'
       AND p_profile #>> '{answers,gathering}' NOT IN (
         'none', 'family_meal', 'reception', 'undecided'
       )
     )
     OR jsonb_typeof(p_profile -> 'autoExcludedItemIds')
       IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_profile -> 'autoExcludedItemIds') > 500 THEN
    RETURN false;
  END IF;

  FOR v_item IN
    SELECT p_profile -> 'answers' -> key
    FROM unnest(ARRAY[
      'internationalMarriage', 'religiousCeremony', 'remarriage',
      'childrenParticipating', 'accessibilitySupport', 'healthSupport',
      'petParticipation', 'familyTradition'
    ]::text[]) AS answer(key)
  LOOP
    IF jsonb_typeof(v_item) NOT IN ('boolean', 'null') THEN
      RETURN false;
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_profile -> 'autoExcludedItemIds') AS item(value)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'string'
       OR char_length(v_item #>> '{}') NOT BETWEEN 1 AND 120
       OR v_item #>> '{}' !~ '^[a-z0-9][a-z0-9_-]{0,119}$'
       OR v_seen ? (v_item #>> '{}') THEN
      RETURN false;
    END IF;
    v_seen := v_seen || jsonb_build_object(v_item #>> '{}', true);
  END LOOP;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.couple_plan_checklist_profile_normalize_v2(
  p_profile jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.couple_plan_checklist_profile_is_valid(p_profile) THEN
    RETURN NULL;
  END IF;
  IF p_profile -> 'version' = '2'::jsonb THEN
    RETURN p_profile;
  END IF;
  RETURN jsonb_set(
    jsonb_set(p_profile, '{version}', '2'::jsonb, false),
    '{answers,gathering}',
    '"undecided"'::jsonb,
    true
  );
END;
$function$;

DO $block$
BEGIN
  IF to_regprocedure(
       'public.couple_plan_checklist_projection_before_gathering_v2(jsonb)'
     ) IS NULL THEN
    ALTER FUNCTION public.couple_plan_checklist_collaboration_projection(jsonb)
      RENAME TO couple_plan_checklist_projection_before_gathering_v2;
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.couple_plan_checklist_collaboration_projection(
  p_progress jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_projection jsonb;
  v_normalized_profile jsonb;
BEGIN
  v_projection :=
    public.couple_plan_checklist_projection_before_gathering_v2(
      p_progress
    );
  v_normalized_profile := public.couple_plan_checklist_profile_normalize_v2(
    COALESCE(p_progress, '{}'::jsonb) -> '__checklist_profile'
  );
  IF v_normalized_profile IS NOT NULL THEN
    v_projection := jsonb_set(
      v_projection,
      '{__checklist_profile}',
      v_normalized_profile,
      true
    );
  END IF;
  RETURN v_projection;
END;
$function$;

CREATE OR REPLACE FUNCTION public.couple_plan_change_is_high_impact(
  p_old_wedding_date date,
  p_new_wedding_date date,
  p_old_venue text,
  p_new_venue text,
  p_old_total_budget bigint,
  p_new_total_budget bigint,
  p_old_progress jsonb,
  p_new_progress jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old_profile jsonb := COALESCE(p_old_progress, '{}'::jsonb)
    -> '__checklist_profile';
  v_new_profile jsonb := COALESCE(p_new_progress, '{}'::jsonb)
    -> '__checklist_profile';
BEGIN
  -- A v2 row must never silently lose the explicit gathering answer. Mark a
  -- syntactically valid v2-to-v1 replacement high impact so the exact-summary
  -- boundary below can reject the downgrade before a request is committed.
  IF public.couple_plan_checklist_profile_is_valid(v_old_profile)
     AND v_old_profile -> 'version' = '2'::jsonb
     AND public.couple_plan_checklist_profile_is_valid(v_new_profile)
     AND v_new_profile -> 'version' = '1'::jsonb THEN
    RETURN true;
  END IF;

  IF public.couple_plan_checklist_collaboration_projection(p_old_progress)
       IS DISTINCT FROM
     public.couple_plan_checklist_collaboration_projection(p_new_progress) THEN
    RETURN true;
  END IF;
  RETURN public.couple_plan_change_is_high_impact_before_checklist(
    p_old_wedding_date,
    p_new_wedding_date,
    p_old_venue,
    p_new_venue,
    p_old_total_budget,
    p_new_total_budget,
    p_old_progress,
    p_new_progress
  );
END;
$function$;

DO $block$
BEGIN
  IF to_regprocedure(
       'public.couple_plan_change_exact_high_summary_before_gathering_v2(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.couple_plan_change_exact_high_summary(
      date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
    ) RENAME TO couple_plan_change_exact_high_summary_before_gathering_v2;
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.couple_plan_change_exact_high_summary(
  p_old_wedding_date date,
  p_new_wedding_date date,
  p_old_venue text,
  p_new_venue text,
  p_old_total_budget bigint,
  p_new_total_budget bigint,
  p_old_progress jsonb,
  p_new_progress jsonb,
  p_bride_id uuid,
  p_groom_id uuid
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old_profile jsonb := COALESCE(p_old_progress, '{}'::jsonb)
    -> '__checklist_profile';
  v_new_profile jsonb := COALESCE(p_new_progress, '{}'::jsonb)
    -> '__checklist_profile';
  v_old_normalized jsonb;
  v_new_normalized jsonb;
  v_old_gathering text;
  v_new_gathering text;
  v_old_label text;
  v_new_label text;
  v_gathering_segment text;
  v_old_summary_progress jsonb := COALESCE(p_old_progress, '{}'::jsonb);
  v_category_key text;
  v_new_category jsonb;
  v_synthetic_old_category jsonb;
  v_base_summary text;
  v_summary text;
  v_structural_marker integer;
BEGIN
  IF public.couple_plan_checklist_profile_is_valid(v_old_profile)
     AND v_old_profile -> 'version' = '2'::jsonb
     AND public.couple_plan_checklist_profile_is_valid(v_new_profile)
     AND v_new_profile -> 'version' = '1'::jsonb THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CHECKLIST_PROFILE_DOWNGRADE'
      USING ERRCODE = '22023';
  END IF;

  -- A category absent from legacy progress semantically starts as
  -- `not_started`. The v1 receipt validator represented that absence as a
  -- category-level applicability transition, which falsely rejected the new
  -- family-meal shape where one reception-only item is N/A but the remaining
  -- category is still active. Normalize only that first materialization for
  -- receipt comparison; the actual old row and applied patch remain exact.
  IF public.couple_plan_checklist_profile_is_valid(v_new_profile)
     AND v_new_profile -> 'version' = '2'::jsonb THEN
    FOR v_category_key, v_new_category IN
      SELECT item.key, item.value
      FROM jsonb_each(COALESCE(p_new_progress, '{}'::jsonb)) AS item(key, value)
      WHERE item.key NOT IN ('__events', '__checklist_profile')
        AND NOT (v_old_summary_progress ? item.key)
        AND jsonb_typeof(item.value) = 'object'
        AND item.value ->> 'status' = 'not_started'
        AND jsonb_typeof(item.value -> 'checklist') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(item.value -> 'checklist')
            AS checklist_item(value)
          WHERE checklist_item.value ->> 'state' = 'not_applicable'
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(item.value -> 'checklist')
            AS checklist_item(value)
          WHERE checklist_item.value ->> 'state' <> 'not_applicable'
        )
    LOOP
      -- Build the semantic predecessor from an allow-list. Copying the whole
      -- new category here would make budget, vendor, ownership, due-date or
      -- arbitrary legacy fields appear unchanged and hide them from the exact
      -- mixed-delta receipt validator.
      v_synthetic_old_category := jsonb_build_object(
        'status',
        'not_started'
      );
      IF v_new_category ? 'category' THEN
        v_synthetic_old_category := v_synthetic_old_category
          || jsonb_build_object('category', v_new_category -> 'category');
      END IF;
      IF v_new_category ? 'label' THEN
        v_synthetic_old_category := v_synthetic_old_category
          || jsonb_build_object('label', v_new_category -> 'label');
      END IF;
      IF v_new_category ? 'name' THEN
        v_synthetic_old_category := v_synthetic_old_category
          || jsonb_build_object('name', v_new_category -> 'name');
      END IF;
      v_old_summary_progress := v_old_summary_progress
        || jsonb_build_object(v_category_key, v_synthetic_old_category);
    END LOOP;
  END IF;

  v_base_summary :=
    public.couple_plan_change_exact_high_summary_before_gathering_v2(
      p_old_wedding_date,
      p_new_wedding_date,
      p_old_venue,
      p_new_venue,
      p_old_total_budget,
      p_new_total_budget,
      v_old_summary_progress,
      p_new_progress,
      p_bride_id,
      p_groom_id
    );

  v_old_normalized :=
    public.couple_plan_checklist_profile_normalize_v2(v_old_profile);
  v_new_normalized :=
    public.couple_plan_checklist_profile_normalize_v2(v_new_profile);
  v_old_gathering := COALESCE(
    v_old_normalized #>> '{answers,gathering}',
    'undecided'
  );
  v_new_gathering := COALESCE(
    v_new_normalized #>> '{answers,gathering}',
    'undecided'
  );
  IF v_old_gathering IS NOT DISTINCT FROM v_new_gathering THEN
    RETURN v_base_summary;
  END IF;

  v_old_label := CASE v_old_gathering
    WHEN 'none' THEN '따로 없음'
    WHEN 'family_meal' THEN '가족 식사만'
    WHEN 'reception' THEN '하객 피로연·축하 모임'
    ELSE '아직 미정'
  END;
  v_new_label := CASE v_new_gathering
    WHEN 'none' THEN '따로 없음'
    WHEN 'family_meal' THEN '가족 식사만'
    WHEN 'reception' THEN '하객 피로연·축하 모임'
    ELSE '아직 미정'
  END;
  v_gathering_segment := format(
    '축하 식사·모임 %s→%s',
    v_old_label,
    v_new_label
  );

  IF strpos(v_base_summary, '답변 변경 없음') > 0 THEN
    v_summary := replace(
      v_base_summary,
      '답변 변경 없음',
      v_gathering_segment
    );
  ELSIF v_base_summary LIKE '상황 변경: %' THEN
    v_summary := '상황 변경: ' || v_gathering_segment || ', '
      || substr(v_base_summary, char_length('상황 변경: ') + 1);
  ELSIF v_base_summary LIKE '상황: %' THEN
    v_summary := '상황: ' || v_gathering_segment || ', '
      || substr(v_base_summary, char_length('상황: ') + 1);
  ELSIF v_base_summary LIKE '상황 질문: %' THEN
    v_summary := '상황 질문: ' || v_gathering_segment || ', '
      || substr(v_base_summary, char_length('상황 질문: ') + 1);
  ELSE
    v_summary := v_gathering_segment || ' · ' || v_base_summary;
  END IF;

  IF char_length(v_summary) > 240 THEN
    v_structural_marker := strpos(v_base_summary, ' · 분야 제외');
    IF v_structural_marker > 0 THEN
      v_summary := '상황 질문: ' || v_gathering_segment
        || substr(v_base_summary, v_structural_marker);
    END IF;
  END IF;
  IF char_length(v_summary) > 240
     OR public.couple_plan_change_has_unsafe_display_text(v_summary) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_SUMMARY_TOO_LONG'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_summary;
END;
$function$;

ALTER FUNCTION public.couple_plan_checklist_profile_is_valid(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_checklist_profile_normalize_v2(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_checklist_collaboration_projection(jsonb)
  OWNER TO postgres;
ALTER FUNCTION
  public.couple_plan_checklist_projection_before_gathering_v2(
    jsonb
  ) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION
  public.couple_plan_change_exact_high_summary_before_gathering_v2(
    date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
  ) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.couple_plan_checklist_profile_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_checklist_profile_normalize_v2(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_checklist_collaboration_projection(
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.couple_plan_checklist_projection_before_gathering_v2(
    jsonb
  ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.couple_plan_change_exact_high_summary_before_gathering_v2(
    date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
  ) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
