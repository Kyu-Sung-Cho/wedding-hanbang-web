BEGIN;

-- Checklist collaboration is shared couple state. Preserve every previously
-- reviewed high-impact wrapper and put the checklist-specific classifier at
-- the public edge of the chain.
DO $block$
BEGIN
  IF to_regprocedure(
       'public.couple_plan_change_is_high_impact_before_checklist(date,date,text,text,bigint,bigint,jsonb,jsonb)'
     ) IS NULL
     AND to_regprocedure(
       'public.couple_plan_change_is_high_impact(date,date,text,text,bigint,bigint,jsonb,jsonb)'
     ) IS NOT NULL THEN
    ALTER FUNCTION public.couple_plan_change_is_high_impact(
      date, date, text, text, bigint, bigint, jsonb, jsonb
    ) RENAME TO couple_plan_change_is_high_impact_before_checklist;
  END IF;

  IF to_regprocedure(
       'public.couple_plan_change_exact_high_summary_before_checklist(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
     ) IS NULL
     AND to_regprocedure(
       'public.couple_plan_change_exact_high_summary(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
     ) IS NOT NULL THEN
    ALTER FUNCTION public.couple_plan_change_exact_high_summary(
      date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
    ) RENAME TO couple_plan_change_exact_high_summary_before_checklist;
  END IF;
END
$block$;

CREATE OR REPLACE FUNCTION public.couple_plan_checklist_safe_label(
  p_preferred text,
  p_fallback text,
  p_max_length integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_value text := btrim(COALESCE(p_preferred, ''));
  v_fallback text := btrim(COALESCE(p_fallback, ''));
BEGIN
  IF char_length(v_value) BETWEEN 1 AND p_max_length
     AND NOT public.couple_plan_change_has_unsafe_display_text(v_value) THEN
    RETURN v_value;
  END IF;
  IF char_length(v_fallback) BETWEEN 1 AND p_max_length
     AND NOT public.couple_plan_change_has_unsafe_display_text(v_fallback) THEN
    RETURN v_fallback;
  END IF;
  RETURN CASE WHEN p_max_length <= 40 THEN '체크리스트' ELSE '체크 항목' END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.couple_plan_checklist_assignee_label(
  p_assignee jsonb,
  p_bride_id uuid,
  p_groom_id uuid,
  p_allow_former_member boolean
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_kind text;
  v_profile_id uuid;
  v_label text;
BEGIN
  IF p_assignee IS NULL OR p_assignee = 'null'::jsonb THEN
    RETURN '미정';
  END IF;
  IF jsonb_typeof(p_assignee) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_assignee -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_ASSIGNEE'
      USING ERRCODE = '22023';
  END IF;

  v_kind := p_assignee ->> 'kind';
  IF v_kind = 'member' THEN
    IF p_assignee - ARRAY['kind', 'profileId']::text[] <> '{}'::jsonb
       OR jsonb_typeof(p_assignee -> 'profileId') IS DISTINCT FROM 'string'
       OR p_assignee ->> 'profileId' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_ASSIGNEE'
        USING ERRCODE = '22023';
    END IF;
    v_profile_id := (p_assignee ->> 'profileId')::uuid;
    IF v_profile_id IS DISTINCT FROM p_bride_id
       AND v_profile_id IS DISTINCT FROM p_groom_id THEN
      IF p_allow_former_member THEN
        RETURN '연결 해제 대상';
      END IF;
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CHECKLIST_ASSIGNEE_NOT_CURRENT_MEMBER'
        USING ERRCODE = '22023';
    END IF;
    RETURN CASE
      WHEN v_profile_id IS NOT DISTINCT FROM p_bride_id THEN '신부'
      WHEN v_profile_id IS NOT DISTINCT FROM p_groom_id THEN '신랑'
      ELSE '연결된 구성원'
    END;
  ELSIF v_kind = 'couple' THEN
    IF p_assignee - 'kind' <> '{}'::jsonb THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_ASSIGNEE'
        USING ERRCODE = '22023';
    END IF;
    RETURN '두 사람 함께';
  ELSIF v_kind = 'external' THEN
    IF p_assignee - ARRAY['kind', 'label']::text[] <> '{}'::jsonb
       OR jsonb_typeof(p_assignee -> 'label') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_ASSIGNEE'
        USING ERRCODE = '22023';
    END IF;
    v_label := btrim(p_assignee ->> 'label');
    IF char_length(v_label) NOT BETWEEN 1 AND 80
       OR public.couple_plan_change_has_unsafe_display_text(v_label) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_ASSIGNEE'
        USING ERRCODE = '22023';
    END IF;
    RETURN '외부 담당(' || v_label || ')';
  END IF;

  RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_ASSIGNEE'
    USING ERRCODE = '22023';
END;
$function$;

-- Only protected checklist collaboration fields participate in this
-- projection. Routine checklist edits therefore continue down the previous
-- wrapper chain, while removal/reordering of an assigned item fails closed in
-- the exact-summary validator.
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
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_category jsonb;
  v_assignees jsonb;
  v_item_applicability jsonb;
  v_not_applicable boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('__invalid_progress', p_progress);
  END IF;

  -- Situation answers are shared planning scope even when they do not happen
  -- to flip a whole category. Keeping the exact profile in the projection
  -- also ensures malformed replacements reach the strict receipt validator.
  IF COALESCE(p_progress, '{}'::jsonb) ? '__checklist_profile' THEN
    v_result := jsonb_build_object(
      '__checklist_profile',
      p_progress -> '__checklist_profile'
    );
  END IF;

  FOR v_key, v_category IN
    SELECT item.key, item.value
    FROM jsonb_each(COALESCE(p_progress, '{}'::jsonb)) AS item(key, value)
    WHERE item.key NOT IN ('__events', '__checklist_profile')
    ORDER BY item.key
  LOOP
    v_not_applicable := jsonb_typeof(v_category) = 'object'
      AND v_category ->> 'status' = 'not_applicable';
    v_assignees := '[]'::jsonb;
    v_item_applicability := '[]'::jsonb;
    IF jsonb_typeof(v_category) = 'object'
       AND jsonb_typeof(v_category -> 'checklist') = 'array' THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'position', checklist_item.position,
            'id', checklist_item.value -> 'id',
            'assignee', checklist_item.value -> 'assignee'
          ) ORDER BY checklist_item.position
        ) FILTER (
          WHERE checklist_item.value ? 'assignee'
            AND checklist_item.value -> 'assignee' <> 'null'::jsonb
        ),
        '[]'::jsonb
      )
      INTO v_assignees
      FROM jsonb_array_elements(v_category -> 'checklist')
        WITH ORDINALITY AS checklist_item(value, position);

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'position', checklist_item.position,
            'id', checklist_item.value -> 'id',
            'notApplicable', true
          ) ORDER BY checklist_item.position
        ) FILTER (
          WHERE checklist_item.value ->> 'state' = 'not_applicable'
        ),
        '[]'::jsonb
      )
      INTO v_item_applicability
      FROM jsonb_array_elements(v_category -> 'checklist')
        WITH ORDINALITY AS checklist_item(value, position);
    ELSIF jsonb_typeof(v_category) = 'object'
          AND v_category ? 'checklist'
          AND v_category -> 'checklist' <> 'null'::jsonb THEN
      v_assignees := jsonb_build_array(
        jsonb_build_object('__invalid_checklist', v_category -> 'checklist')
      );
      v_item_applicability := v_assignees;
    END IF;

    IF v_not_applicable
       OR v_assignees <> '[]'::jsonb
       OR v_item_applicability <> '[]'::jsonb THEN
      v_result := v_result || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'notApplicable', v_not_applicable,
          'assignees', v_assignees,
          'itemApplicability', v_item_applicability
        )
      );
    END IF;
  END LOOP;
  RETURN v_result;
END;
$function$;

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
  v_item jsonb;
  v_seen jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
     OR p_profile - ARRAY[
       'version', 'reviewedAt', 'answers', 'autoExcludedItemIds'
     ]::text[] <> '{}'::jsonb
     OR p_profile -> 'version' <> '1'::jsonb
     OR jsonb_typeof(p_profile -> 'reviewedAt') IS DISTINCT FROM 'string'
     OR char_length(p_profile ->> 'reviewedAt') NOT BETWEEN 20 AND 40
     OR public.couple_plan_change_has_unsafe_display_text(
       p_profile ->> 'reviewedAt'
     )
     OR p_profile ->> 'reviewedAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
     OR jsonb_typeof(p_profile -> 'answers') IS DISTINCT FROM 'object'
     OR (p_profile -> 'answers') - ARRAY[
       'ceremony', 'legalMarriage', 'travel', 'housing',
       'internationalMarriage', 'religiousCeremony', 'remarriage',
       'childrenParticipating', 'accessibilitySupport', 'healthSupport',
       'petParticipation', 'familyTradition'
     ]::text[] <> '{}'::jsonb
     OR NOT (p_profile -> 'answers' ?& ARRAY[
       'ceremony', 'legalMarriage', 'travel', 'housing',
       'internationalMarriage', 'religiousCeremony', 'remarriage',
       'childrenParticipating', 'accessibilitySupport', 'healthSupport',
       'petParticipation', 'familyTradition'
     ]::text[])
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
BEGIN
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
  v_old_projection jsonb;
  v_new_projection jsonb;
  v_profile_changed boolean;
  v_key text;
  v_old_category jsonb;
  v_new_category jsonb;
  v_old_category_rest jsonb;
  v_new_category_rest jsonb;
  v_old_checklist jsonb;
  v_new_checklist jsonb;
  v_old_item jsonb;
  v_new_item jsonb;
  v_old_item_rest jsonb;
  v_new_item_rest jsonb;
  v_position integer;
  v_status_delta boolean;
  v_non_scope_status_delta boolean;
  v_item_applicability_delta boolean;
  v_old_status text;
  v_new_status text;
  v_category_label text;
  v_item_label text;
  v_old_item_label text;
  v_old_assignee_label text;
  v_new_assignee_label text;
  v_summary text := '';
  v_segment text;
  v_category_segments text := '';
  v_item_segments text := '';
  v_item_excluded_segments text := '';
  v_item_restored_segments text := '';
  v_answer_segments text := '';
  v_answer_name_segments text := '';
  v_reviewed_segments text := '';
  v_review_cleared_segments text := '';
  v_assignee_count integer := 0;
  v_category_excluded_count integer := 0;
  v_category_restored_count integer := 0;
  v_item_excluded_count integer := 0;
  v_item_restored_count integer := 0;
  v_reviewed_count integer := 0;
  v_review_cleared_count integer := 0;
  v_new_item_count integer := 0;
  v_renamed_item_count integer := 0;
  v_status_repair_count integer := 0;
  v_structure_segments text := '';
  v_status_repair_segments text := '';
  v_actual_excluded_ids jsonb := '[]'::jsonb;
  v_actual_restored_ids jsonb := '[]'::jsonb;
  v_profile_auto_count integer := 0;
  v_profile_added_ids text := '';
  v_profile_removed_ids text := '';
  v_profile_summary text := '';
  v_auto_id_matches integer;
  v_seen_ids jsonb;
  v_old_seen_ids jsonb;
  v_old_position integer;
  v_last_old_position integer;
  v_old_count integer;
  v_matched_old_count integer;
  v_old_state text;
  v_new_state text;
  v_old_done boolean;
  v_new_done boolean;
  v_review_source text;
  v_review_actor text;
  v_reviewed_at text;
  v_category_assignee_start integer;
  v_category_item_applicability_start integer;
  v_category_new_item_start integer;
  v_old_items_all_completed boolean;
  v_old_profile_valid boolean;
  v_profile_reviewed_at_changed boolean;
  v_answer_key text;
  v_answer_label text;
  v_old_answer jsonb;
  v_new_answer jsonb;
  v_old_answer_label text;
  v_new_answer_label text;
BEGIN
  v_old_projection :=
    public.couple_plan_checklist_collaboration_projection(p_old_progress);
  v_new_projection :=
    public.couple_plan_checklist_collaboration_projection(p_new_progress);
  IF v_old_projection IS NOT DISTINCT FROM v_new_projection THEN
    RETURN public.couple_plan_change_exact_high_summary_before_checklist(
      p_old_wedding_date,
      p_new_wedding_date,
      p_old_venue,
      p_new_venue,
      p_old_total_budget,
      p_new_total_budget,
      p_old_progress,
      p_new_progress,
      p_bride_id,
      p_groom_id
    );
  END IF;

  -- Checklist collaboration has its own exact receipt. A second high-impact
  -- domain or an unrelated routine mutation must be submitted separately.
  IF p_old_wedding_date IS DISTINCT FROM p_new_wedding_date
     OR p_old_venue IS DISTINCT FROM p_new_venue
     OR p_old_total_budget IS DISTINCT FROM p_new_total_budget
     OR (COALESCE(p_old_progress, '{}'::jsonb) -> '__events')
          IS DISTINCT FROM
        (COALESCE(p_new_progress, '{}'::jsonb) -> '__events')
     OR jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb))
          IS DISTINCT FROM 'object'
     OR jsonb_typeof(COALESCE(p_new_progress, '{}'::jsonb))
          IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
      USING ERRCODE = '22023';
  END IF;

  v_profile_changed :=
    (COALESCE(p_old_progress, '{}'::jsonb) -> '__checklist_profile')
      IS DISTINCT FROM
    (COALESCE(p_new_progress, '{}'::jsonb) -> '__checklist_profile');
  IF v_profile_changed AND NOT public.couple_plan_checklist_profile_is_valid(
       COALESCE(p_new_progress, '{}'::jsonb) -> '__checklist_profile'
     ) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key IN
    SELECT old_key.key
    FROM jsonb_object_keys(COALESCE(p_old_progress, '{}'::jsonb))
      AS old_key(key)
    WHERE old_key.key NOT IN ('__events', '__checklist_profile')
    UNION
    SELECT new_key.key
    FROM jsonb_object_keys(COALESCE(p_new_progress, '{}'::jsonb))
      AS new_key(key)
    WHERE new_key.key NOT IN ('__events', '__checklist_profile')
    ORDER BY 1
  LOOP
    v_category_assignee_start := v_assignee_count;
    v_category_item_applicability_start :=
      v_item_excluded_count + v_item_restored_count;
    v_category_new_item_start := v_new_item_count;
    v_old_items_all_completed := true;
    v_old_category := p_old_progress -> v_key;
    v_new_category := p_new_progress -> v_key;
    IF v_old_category IS NOT DISTINCT FROM v_new_category THEN
      CONTINUE;
    END IF;
    IF (v_old_category IS NOT NULL
        AND jsonb_typeof(v_old_category) IS DISTINCT FROM 'object')
       OR (v_new_category IS NOT NULL
        AND jsonb_typeof(v_new_category) IS DISTINCT FROM 'object')
       OR v_new_category IS NULL THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;

    v_category_label := public.couple_plan_checklist_safe_label(
      COALESCE(
        v_new_category ->> 'label',
        v_old_category ->> 'label',
        v_new_category ->> 'name',
        v_old_category ->> 'name',
        v_new_category ->> 'category',
        v_old_category ->> 'category'
      ),
      v_key,
      40
    );
    IF (v_new_category ? 'label')
       AND (
         jsonb_typeof(v_new_category -> 'label') IS DISTINCT FROM 'string'
         OR char_length(btrim(v_new_category ->> 'label')) NOT BETWEEN 1 AND 200
         OR public.couple_plan_change_has_unsafe_display_text(
           btrim(v_new_category ->> 'label')
         )
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_LABEL'
        USING ERRCODE = '22023';
    END IF;

    -- Review evidence may be added with the protected decision. A situation
    -- profile may also clear only evidence that it previously created when
    -- the corresponding applicability answer returns to undecided.
    IF (v_old_category -> 'checklistReviewedAt') IS DISTINCT FROM
         (v_new_category -> 'checklistReviewedAt')
       OR (v_old_category -> 'checklistReviewedByProfileId') IS DISTINCT FROM
         (v_new_category -> 'checklistReviewedByProfileId')
       OR (v_old_category -> 'checklistReviewSource') IS DISTINCT FROM
         (v_new_category -> 'checklistReviewSource') THEN
      IF v_old_category ?| ARRAY[
           'checklistReviewedAt',
           'checklistReviewedByProfileId',
           'checklistReviewSource'
         ]::text[] THEN
        IF NOT v_profile_changed
           OR v_old_category ->> 'checklistReviewSource'
                <> 'situation_profile'
           OR v_new_category ?| ARRAY[
                'checklistReviewedAt',
                'checklistReviewedByProfileId',
                'checklistReviewSource'
              ]::text[] THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
            USING ERRCODE = '22023';
        END IF;
        v_review_cleared_count := v_review_cleared_count + 1;
        v_review_cleared_segments := CASE
          WHEN v_review_cleared_segments = '' THEN v_category_label
          ELSE v_review_cleared_segments || ', ' || v_category_label
        END;
      ELSE
        v_reviewed_at := v_new_category ->> 'checklistReviewedAt';
        v_review_source := v_new_category ->> 'checklistReviewSource';
        v_review_actor := v_new_category ->> 'checklistReviewedByProfileId';
        IF jsonb_typeof(v_new_category -> 'checklistReviewedAt')
             IS DISTINCT FROM 'string'
           OR char_length(v_reviewed_at) NOT BETWEEN 20 AND 40
           OR public.couple_plan_change_has_unsafe_display_text(v_reviewed_at)
           OR v_review_source NOT IN ('manual', 'situation_profile')
           OR (
             v_review_actor IS NOT NULL
             AND v_review_actor <> ''
             AND v_review_actor IS DISTINCT FROM COALESCE(p_bride_id::text, '')
             AND v_review_actor IS DISTINCT FROM COALESCE(p_groom_id::text, '')
           ) THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_REVIEW'
            USING ERRCODE = '22023';
        END IF;
        v_reviewed_count := v_reviewed_count + 1;
        v_reviewed_segments := CASE
          WHEN v_reviewed_segments = '' THEN v_category_label
          ELSE v_reviewed_segments || ', ' || v_category_label
        END;
      END IF;
    END IF;

    v_old_category_rest := COALESCE(v_old_category, '{}'::jsonb) - ARRAY[
      'status', 'checklist', 'checklistReviewedAt',
      'checklistReviewedByProfileId', 'checklistReviewSource'
    ]::text[];
    v_new_category_rest := v_new_category - ARRAY[
      'status', 'checklist', 'checklistReviewedAt',
      'checklistReviewedByProfileId', 'checklistReviewSource'
    ]::text[];
    IF v_old_category IS NULL THEN
      IF v_new_category_rest - ARRAY['category', 'label', 'name']::text[]
           <> '{}'::jsonb THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_old_category_rest IS DISTINCT FROM v_new_category_rest THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;

    v_old_status := v_old_category ->> 'status';
    v_new_status := v_new_category ->> 'status';
    v_status_delta := (v_old_status = 'not_applicable') IS DISTINCT FROM
      (v_new_status = 'not_applicable');
    v_non_scope_status_delta := v_old_category IS NOT NULL
      AND v_old_status IS DISTINCT FROM v_new_status
      AND NOT v_status_delta;
    IF v_old_category IS NULL
       AND v_new_status NOT IN ('not_started', 'not_applicable') THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;
    IF v_status_delta THEN
      IF v_new_status = 'not_applicable' THEN
        v_category_excluded_count := v_category_excluded_count + 1;
        v_segment := v_category_label || ' → 해당 없음';
      ELSE
        v_category_restored_count := v_category_restored_count + 1;
        v_segment := v_category_label || ' → 준비 목록';
      END IF;
      v_category_segments := CASE
        WHEN v_category_segments = '' THEN v_segment
        ELSE v_category_segments || ', ' || v_segment
      END;
    END IF;

    v_old_checklist := v_old_category -> 'checklist';
    v_new_checklist := v_new_category -> 'checklist';
    IF v_new_checklist IS NULL AND v_old_checklist IS NULL THEN
      IF NOT v_status_delta OR v_profile_changed THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA'
          USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    IF v_new_checklist IS NULL
       OR jsonb_typeof(v_new_checklist) IS DISTINCT FROM 'array'
       OR (v_old_checklist IS NOT NULL
         AND jsonb_typeof(v_old_checklist) IS DISTINCT FROM 'array') THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA'
        USING ERRCODE = '22023';
    END IF;
    IF v_old_checklist IS NOT NULL
       AND jsonb_array_length(v_old_checklist) >
         jsonb_array_length(v_new_checklist) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY'
        USING ERRCODE = '22023';
    END IF;

    v_old_count := COALESCE(jsonb_array_length(v_old_checklist), 0);
    v_matched_old_count := 0;
    v_last_old_position := -1;
    v_old_seen_ids := '{}'::jsonb;
    IF v_old_checklist IS NOT NULL THEN
      FOR v_old_position IN 0..jsonb_array_length(v_old_checklist) - 1
      LOOP
        v_old_item := v_old_checklist -> v_old_position;
        IF jsonb_typeof(v_old_item) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_old_item -> 'id') IS DISTINCT FROM 'string'
           OR char_length(v_old_item ->> 'id') NOT BETWEEN 1 AND 120
           OR v_old_item ->> 'id' !~ '^[a-z0-9][a-z0-9_-]{0,119}$'
           OR v_old_seen_ids ? (v_old_item ->> 'id') THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY'
            USING ERRCODE = '22023';
        END IF;
        v_old_seen_ids := v_old_seen_ids || jsonb_build_object(
          v_old_item ->> 'id', true
        );
      END LOOP;
    END IF;

    v_seen_ids := '{}'::jsonb;
    FOR v_position IN 0..GREATEST(jsonb_array_length(v_new_checklist) - 1, -1)
    LOOP
      v_new_item := v_new_checklist -> v_position;
      IF jsonb_typeof(v_new_item) IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_new_item -> 'id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_new_item -> 'label') IS DISTINCT FROM 'string'
         OR char_length(v_new_item ->> 'id') NOT BETWEEN 1 AND 120
         OR v_new_item ->> 'id' !~ '^[a-z0-9][a-z0-9_-]{0,119}$'
         OR char_length(btrim(v_new_item ->> 'label')) NOT BETWEEN 1 AND 400
         OR public.couple_plan_change_has_unsafe_display_text(
           btrim(v_new_item ->> 'label')
         )
         OR v_seen_ids ? (v_new_item ->> 'id') THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY'
          USING ERRCODE = '22023';
      END IF;
      v_seen_ids := v_seen_ids || jsonb_build_object(v_new_item ->> 'id', true);
      v_item_label := public.couple_plan_checklist_safe_label(
        v_new_item ->> 'label',
        v_new_item ->> 'id',
        120
      );

      v_old_item := NULL;
      v_old_position := NULL;
      IF v_old_checklist IS NOT NULL THEN
        SELECT old_item.value, (old_item.position - 1)::integer
        INTO v_old_item, v_old_position
        FROM jsonb_array_elements(v_old_checklist)
          WITH ORDINALITY AS old_item(value, position)
        WHERE old_item.value ->> 'id' = v_new_item ->> 'id';
      END IF;
      IF v_old_item IS NOT NULL THEN
        IF v_old_position <= v_last_old_position THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY'
            USING ERRCODE = '22023';
        END IF;
        v_last_old_position := v_old_position;
        v_matched_old_count := v_matched_old_count + 1;
      ELSE
        IF v_new_item - ARRAY[
             'id', 'label', 'done', 'state', 'assignee'
           ]::text[] <> '{}'::jsonb
           OR jsonb_typeof(v_new_item -> 'done') IS DISTINCT FROM 'boolean'
           OR (v_new_item ->> 'done')::boolean
           OR COALESCE(v_new_item ->> 'state', 'todo') NOT IN (
             'todo', 'not_applicable'
           )
           OR (NOT v_profile_changed
             AND COALESCE(v_new_item ->> 'state', 'todo') <> 'todo') THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
            USING ERRCODE = '22023';
        END IF;
      END IF;

      IF (
           v_old_item IS NULL
           OR (v_old_item -> 'label') IS DISTINCT FROM
              (v_new_item -> 'label')
         )
         AND char_length(btrim(v_new_item ->> 'label')) > 120 THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_LABEL'
          USING ERRCODE = '22023';
      END IF;

      -- Template materialization and copy refreshes are allowed only when the
      -- protected receipt names every structural delta. The 240-character
      -- receipt cap below makes a large or ambiguous bundle fail closed and
      -- forces callers to materialize it separately.
      IF v_old_item IS NULL THEN
        v_new_item_count := v_new_item_count + 1;
        v_segment := format('%s · %s 추가', v_category_label, v_item_label);
        v_structure_segments := CASE
          WHEN v_structure_segments = '' THEN v_segment
          ELSE v_structure_segments || ', ' || v_segment
        END;
      ELSIF (v_old_item -> 'label') IS DISTINCT FROM
            (v_new_item -> 'label') THEN
        v_old_item_label := public.couple_plan_checklist_safe_label(
          v_old_item ->> 'label',
          v_old_item ->> 'id',
          120
        );
        v_renamed_item_count := v_renamed_item_count + 1;
        v_segment := format(
          '%s · %s → %s 문구 변경',
          v_category_label,
          v_old_item_label,
          v_item_label
        );
        v_structure_segments := CASE
          WHEN v_structure_segments = '' THEN v_segment
          ELSE v_structure_segments || ', ' || v_segment
        END;
      END IF;

      IF NULLIF(v_old_item -> 'assignee', 'null'::jsonb) IS DISTINCT FROM
           NULLIF(v_new_item -> 'assignee', 'null'::jsonb) THEN
        IF v_profile_changed OR v_status_delta THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
            USING ERRCODE = '22023';
        END IF;
        v_old_assignee_label :=
          public.couple_plan_checklist_assignee_label(
            v_old_item -> 'assignee', p_bride_id, p_groom_id, true
          );
        v_new_assignee_label :=
          public.couple_plan_checklist_assignee_label(
            v_new_item -> 'assignee', p_bride_id, p_groom_id, false
          );
        v_assignee_count := v_assignee_count + 1;
        v_segment := format(
          '%s · %s 담당: %s → %s',
          v_category_label,
          v_item_label,
          v_old_assignee_label,
          v_new_assignee_label
        );
        v_summary := CASE
          WHEN v_summary = '' THEN v_segment
          ELSE v_summary || ' · ' || v_segment
        END;
      END IF;

      -- `completed` was the status boolean used by the first checklist
      -- client. Treat it as the semantic predecessor of canonical
      -- `done`/`state`, but only after proving the two representations do not
      -- disagree. Every field outside that narrow projection is still
      -- compared below, so an assignee/applicability receipt cannot hide a
      -- note, due date, completion actor, or other mutation.
      IF (
           v_old_item IS NOT NULL
           AND (
             (v_old_item ? 'completed'
               AND jsonb_typeof(v_old_item -> 'completed')
                 NOT IN ('boolean', 'null'))
             OR (v_old_item ? 'done'
               AND jsonb_typeof(v_old_item -> 'done')
                 NOT IN ('boolean', 'null'))
             OR (v_old_item ? 'state'
               AND (
                 jsonb_typeof(v_old_item -> 'state')
                   NOT IN ('string', 'null')
                 OR (
                   jsonb_typeof(v_old_item -> 'state') = 'string'
                   AND v_old_item ->> 'state' NOT IN (
                   'todo', 'in_progress', 'waiting', 'blocked',
                   'completed', 'not_applicable'
                   )
                 )
               ))
             OR (
               jsonb_typeof(v_old_item -> 'completed') = 'boolean'
               AND jsonb_typeof(v_old_item -> 'done') = 'boolean'
               AND (v_old_item -> 'completed') IS DISTINCT FROM
                 (v_old_item -> 'done')
             )
           )
         )
         OR (v_new_item ? 'completed'
           AND jsonb_typeof(v_new_item -> 'completed')
             NOT IN ('boolean', 'null'))
         OR (v_new_item ? 'done'
           AND jsonb_typeof(v_new_item -> 'done')
             NOT IN ('boolean', 'null'))
         OR (v_new_item ? 'state'
           AND (
             jsonb_typeof(v_new_item -> 'state') NOT IN ('string', 'null')
             OR (
               jsonb_typeof(v_new_item -> 'state') = 'string'
               AND v_new_item ->> 'state' NOT IN (
                 'todo', 'in_progress', 'waiting', 'blocked',
                 'completed', 'not_applicable'
               )
             )
           ))
         OR (
           jsonb_typeof(v_new_item -> 'completed') = 'boolean'
           AND jsonb_typeof(v_new_item -> 'done') = 'boolean'
           AND (v_new_item -> 'completed') IS DISTINCT FROM
             (v_new_item -> 'done')
         ) THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA'
          USING ERRCODE = '22023';
      END IF;
      v_old_done := CASE
        WHEN jsonb_typeof(v_old_item -> 'done') = 'boolean'
          THEN (v_old_item ->> 'done')::boolean
        WHEN jsonb_typeof(v_old_item -> 'completed') = 'boolean'
          THEN (v_old_item ->> 'completed')::boolean
        ELSE false
      END;
      v_new_done := CASE
        WHEN jsonb_typeof(v_new_item -> 'done') = 'boolean'
          THEN (v_new_item ->> 'done')::boolean
        WHEN jsonb_typeof(v_new_item -> 'completed') = 'boolean'
          THEN (v_new_item ->> 'completed')::boolean
        ELSE false
      END;
      v_old_state := CASE
        WHEN v_old_item ->> 'state' IS NOT NULL THEN v_old_item ->> 'state'
        WHEN v_old_done THEN 'completed'
        ELSE 'todo'
      END;
      v_new_state := CASE
        WHEN v_new_item ->> 'state' IS NOT NULL THEN v_new_item ->> 'state'
        WHEN v_new_done THEN 'completed'
        ELSE 'todo'
      END;
      IF v_old_item IS NOT NULL AND v_old_state <> 'completed' THEN
        v_old_items_all_completed := false;
      END IF;
      IF v_old_item IS NOT NULL
         AND (
           v_old_done IS DISTINCT FROM (v_old_state = 'completed')
           OR v_new_done IS DISTINCT FROM (v_new_state = 'completed')
         ) THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA'
          USING ERRCODE = '22023';
      END IF;

      v_old_item_rest := COALESCE(v_old_item, '{}'::jsonb) - ARRAY[
        'id', 'label', 'assignee', 'state', 'done', 'completed'
      ]::text[];
      v_new_item_rest := v_new_item - ARRAY[
        'id', 'label', 'assignee', 'state', 'done', 'completed'
      ]::text[];
      IF v_old_item_rest -> 'dueDate' = 'null'::jsonb THEN
        v_old_item_rest := v_old_item_rest - 'dueDate';
      END IF;
      IF v_new_item_rest -> 'dueDate' = 'null'::jsonb THEN
        v_new_item_rest := v_new_item_rest - 'dueDate';
      END IF;
      IF v_old_item_rest ->> 'note' = '' THEN
        v_old_item_rest := v_old_item_rest - 'note';
      END IF;
      IF v_new_item_rest ->> 'note' = '' THEN
        v_new_item_rest := v_new_item_rest - 'note';
      END IF;
      IF v_old_state <> 'completed' THEN
        IF NULLIF(v_old_item ->> 'completedAt', '') IS NOT NULL
           OR NULLIF(v_old_item ->> 'completedByProfileId', '') IS NOT NULL THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA'
            USING ERRCODE = '22023';
        END IF;
        v_old_item_rest := v_old_item_rest - ARRAY[
          'completedAt', 'completedByProfileId'
        ]::text[];
      END IF;
      IF v_new_state <> 'completed' THEN
        IF NULLIF(v_new_item ->> 'completedAt', '') IS NOT NULL
           OR NULLIF(v_new_item ->> 'completedByProfileId', '') IS NOT NULL THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA'
            USING ERRCODE = '22023';
        END IF;
        v_new_item_rest := v_new_item_rest - ARRAY[
          'completedAt', 'completedByProfileId'
        ]::text[];
      END IF;
      v_item_applicability_delta :=
        (v_old_state = 'not_applicable') IS DISTINCT FROM
        (v_new_state = 'not_applicable');

      IF v_old_item IS NOT NULL THEN
        IF (
             v_old_state IS DISTINCT FROM v_new_state
             AND NOT v_item_applicability_delta
           )
           OR (
             v_item_applicability_delta
             AND (
               v_old_item_rest - ARRAY[
                 'completedAt', 'completedByProfileId'
               ]::text[]
             ) IS DISTINCT FROM (
               v_new_item_rest - ARRAY[
                 'completedAt', 'completedByProfileId'
               ]::text[]
             )
           )
           OR (
             NOT v_item_applicability_delta
             AND v_old_item_rest IS DISTINCT FROM v_new_item_rest
           ) THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
            USING ERRCODE = '22023';
        END IF;
      END IF;

      IF v_item_applicability_delta THEN
        IF v_profile_changed
           AND (
             (
               v_new_state = 'not_applicable'
               AND NOT (
                 p_new_progress -> '__checklist_profile'
                   -> 'autoExcludedItemIds'
               ) ? (v_new_item ->> 'id')
             )
             OR (
               v_new_state <> 'not_applicable'
               AND (
                 p_new_progress -> '__checklist_profile'
                   -> 'autoExcludedItemIds'
               ) ? (v_new_item ->> 'id')
             )
           ) THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE_DELTA'
            USING ERRCODE = '22023';
        END IF;

        IF v_new_state = 'not_applicable' THEN
          v_item_excluded_count := v_item_excluded_count + 1;
          v_actual_excluded_ids := v_actual_excluded_ids
            || jsonb_build_array(v_new_item ->> 'id');
          v_segment := v_category_label || '·' || v_item_label;
          v_item_excluded_segments := CASE
            WHEN v_item_excluded_segments = '' THEN v_segment
            ELSE v_item_excluded_segments || ', ' || v_segment
          END;
        ELSE
          v_item_restored_count := v_item_restored_count + 1;
          v_actual_restored_ids := v_actual_restored_ids
            || jsonb_build_array(v_new_item ->> 'id');
          v_segment := v_category_label || '·' || v_item_label;
          v_item_restored_segments := CASE
            WHEN v_item_restored_segments = '' THEN v_segment
            ELSE v_item_restored_segments || ', ' || v_segment
          END;
        END IF;
        v_item_segments := CASE
          WHEN v_item_segments = '' THEN v_segment
          ELSE v_item_segments || ', ' || v_segment
        END;
      END IF;
    END LOOP;

    IF v_matched_old_count <> v_old_count THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY'
        USING ERRCODE = '22023';
    END IF;

    -- A legacy category could truthfully be `completed` before item-level
    -- evidence existed or before a newer template introduced todo work. Its
    -- first protected assignment materializes canonical todo rows. With no
    -- legacy checklist the derived status is `not_started`; with completed
    -- legacy rows plus new todo work it is `in_progress`. Permit only those
    -- exact semantic repairs, and only when the same category also contains
    -- a protected assignee decision. Any ordinary or cross-category stale
    -- status change remains a mixed delta.
    IF v_non_scope_status_delta THEN
      IF v_profile_changed
         OR v_old_status <> 'completed'
         OR NOT (
           (
             v_old_count = 0
             AND NOT (v_old_category ? 'checklist')
             AND v_new_status = 'not_started'
           )
           OR (
             v_old_count >= 1
             AND v_old_items_all_completed
             AND v_new_status = 'in_progress'
           )
         )
         OR v_new_item_count <= v_category_new_item_start
         OR v_assignee_count <= v_category_assignee_start
         OR v_item_excluded_count + v_item_restored_count <>
           v_category_item_applicability_start THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
          USING ERRCODE = '22023';
      END IF;
      v_status_repair_count := v_status_repair_count + 1;
      v_segment := format(
        '%s 상태 보정: 완료 → %s(새 항목 %s개 반영)',
        v_category_label,
        CASE v_new_status
          WHEN 'not_started' THEN '시작 전'
          WHEN 'in_progress' THEN '진행 중'
        END,
        v_new_item_count - v_category_new_item_start
      );
      v_status_repair_segments := CASE
        WHEN v_status_repair_segments = '' THEN v_segment
        ELSE v_status_repair_segments || ', ' || v_segment
      END;
    END IF;

    IF NOT v_profile_changed
       AND NOT v_status_delta
       AND v_old_checklist IS NOT NULL
       AND v_old_checklist IS DISTINCT FROM v_new_checklist
       AND v_assignee_count = v_category_assignee_start
       AND v_item_excluded_count + v_item_restored_count =
         v_category_item_applicability_start THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;
    IF NOT v_profile_changed
       AND NOT v_status_delta
       AND v_assignee_count = v_category_assignee_start
       AND v_item_excluded_count + v_item_restored_count =
         v_category_item_applicability_start THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;
    IF v_assignee_count > v_category_assignee_start
       AND v_item_excluded_count + v_item_restored_count >
         v_category_item_applicability_start THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;
    IF v_status_delta AND (
         (
           v_new_status = 'not_applicable'
           AND v_item_restored_count > v_category_item_applicability_start
         )
         OR (
           v_new_status <> 'not_applicable'
           AND v_item_excluded_count > v_category_item_applicability_start
         )
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_profile_changed THEN
    IF v_assignee_count > 0 THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;

    -- Preserve valid legacy answers, but derive old automatic ownership only
    -- from IDs that are still backed by an actual old N/A checklist row. A
    -- retired orphan can therefore be dropped without inventing a restore;
    -- one orphan must never erase another still-backed ownership claim.
    v_old_profile_valid := public.couple_plan_checklist_profile_is_valid(
      COALESCE(p_old_progress, '{}'::jsonb) -> '__checklist_profile'
    );

    SELECT count(*)::integer
    INTO v_profile_auto_count
    FROM jsonb_array_elements(
      p_new_progress -> '__checklist_profile' -> 'autoExcludedItemIds'
    ) AS profile_id(value);

    SELECT string_agg(item_id, ',' ORDER BY item_id)
    INTO v_profile_added_ids
    FROM (
      SELECT profile_id.value #>> '{}' AS item_id
      FROM jsonb_array_elements(
        p_new_progress -> '__checklist_profile' -> 'autoExcludedItemIds'
      ) AS profile_id(value)
      EXCEPT
      SELECT profile_id.value #>> '{}' AS item_id
      FROM jsonb_array_elements(
        CASE
          WHEN v_old_profile_valid
            THEN p_old_progress -> '__checklist_profile' -> 'autoExcludedItemIds'
          ELSE '[]'::jsonb
        END
      ) AS profile_id(value)
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(p_old_progress, '{}'::jsonb))
          AS old_category(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(old_category.value -> 'checklist') = 'array'
              THEN old_category.value -> 'checklist'
            ELSE '[]'::jsonb
          END
        ) AS old_checklist_item(value)
        WHERE old_checklist_item.value ->> 'id' = profile_id.value #>> '{}'
          AND old_checklist_item.value ->> 'state' = 'not_applicable'
      )
    ) AS added;

    SELECT string_agg(item_id, ',' ORDER BY item_id)
    INTO v_profile_removed_ids
    FROM (
      SELECT profile_id.value #>> '{}' AS item_id
      FROM jsonb_array_elements(
        CASE
          WHEN v_old_profile_valid
            THEN p_old_progress -> '__checklist_profile' -> 'autoExcludedItemIds'
          ELSE '[]'::jsonb
        END
      ) AS profile_id(value)
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(p_old_progress, '{}'::jsonb))
          AS old_category(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(old_category.value -> 'checklist') = 'array'
              THEN old_category.value -> 'checklist'
            ELSE '[]'::jsonb
          END
        ) AS old_checklist_item(value)
        WHERE old_checklist_item.value ->> 'id' = profile_id.value #>> '{}'
          AND old_checklist_item.value ->> 'state' = 'not_applicable'
      )
      EXCEPT
      SELECT profile_id.value #>> '{}' AS item_id
      FROM jsonb_array_elements(
        p_new_progress -> '__checklist_profile' -> 'autoExcludedItemIds'
      ) AS profile_id(value)
    ) AS removed;

    IF COALESCE(v_profile_added_ids, '') IS DISTINCT FROM COALESCE((
         SELECT string_agg(item_id, ',' ORDER BY item_id)
         FROM jsonb_array_elements_text(v_actual_excluded_ids) AS item(item_id)
       ), '')
       OR COALESCE(v_profile_removed_ids, '') IS DISTINCT FROM COALESCE((
         SELECT string_agg(item_id, ',' ORDER BY item_id)
         FROM jsonb_array_elements_text(v_actual_restored_ids) AS item(item_id)
       ), '') THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE_DELTA'
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer
    INTO v_auto_id_matches
    FROM jsonb_each(COALESCE(p_new_progress, '{}'::jsonb)) AS category(key, value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(category.value -> 'checklist') = 'array'
          THEN category.value -> 'checklist'
        ELSE '[]'::jsonb
      END
    ) AS checklist_item(value)
    WHERE checklist_item.value ->> 'state' = 'not_applicable'
      AND (
        p_new_progress -> '__checklist_profile' -> 'autoExcludedItemIds'
      ) ? (checklist_item.value ->> 'id');
    IF v_auto_id_matches <> v_profile_auto_count THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE_DELTA'
        USING ERRCODE = '22023';
    END IF;

    v_profile_reviewed_at_changed :=
      (COALESCE(p_old_progress, '{}'::jsonb) -> '__checklist_profile'
        -> 'reviewedAt') IS DISTINCT FROM
      (p_new_progress -> '__checklist_profile' -> 'reviewedAt');
    FOR v_answer_key, v_answer_label IN
      SELECT answer.key, answer.label
      FROM (VALUES
        ('ceremony', '예식'),
        ('legalMarriage', '법적 혼인'),
        ('travel', '여행'),
        ('housing', '주거'),
        ('internationalMarriage', '국제결혼'),
        ('religiousCeremony', '종교 예식'),
        ('remarriage', '재혼'),
        ('childrenParticipating', '자녀 참여'),
        ('accessibilitySupport', '접근성 지원'),
        ('healthSupport', '건강 지원'),
        ('petParticipation', '반려동물 참여'),
        ('familyTradition', '가족 전통')
      ) AS answer(key, label)
    LOOP
      v_new_answer := p_new_progress -> '__checklist_profile'
        -> 'answers' -> v_answer_key;
      v_old_answer := CASE
        WHEN v_old_profile_valid THEN
          p_old_progress -> '__checklist_profile' -> 'answers' -> v_answer_key
        WHEN v_answer_key IN (
          'ceremony', 'legalMarriage', 'travel', 'housing'
        ) THEN to_jsonb('undecided'::text)
        ELSE 'null'::jsonb
      END;
      IF v_old_answer IS NOT DISTINCT FROM v_new_answer THEN
        CONTINUE;
      END IF;

      IF v_answer_key IN ('ceremony', 'legalMarriage') THEN
        v_old_answer_label := CASE v_old_answer #>> '{}'
          WHEN 'yes' THEN '함' WHEN 'no' THEN '안함' ELSE '미정' END;
        v_new_answer_label := CASE v_new_answer #>> '{}'
          WHEN 'yes' THEN '함' WHEN 'no' THEN '안함' ELSE '미정' END;
      ELSIF v_answer_key = 'travel' THEN
        v_old_answer_label := CASE v_old_answer #>> '{}'
          WHEN 'domestic' THEN '국내' WHEN 'international' THEN '해외'
          WHEN 'none' THEN '안함' ELSE '미정' END;
        v_new_answer_label := CASE v_new_answer #>> '{}'
          WHEN 'domestic' THEN '국내' WHEN 'international' THEN '해외'
          WHEN 'none' THEN '안함' ELSE '미정' END;
      ELSIF v_answer_key = 'housing' THEN
        v_old_answer_label := CASE v_old_answer #>> '{}'
          WHEN 'rent' THEN '임차' WHEN 'buy' THEN '구매'
          WHEN 'other' THEN '기타' ELSE '미정' END;
        v_new_answer_label := CASE v_new_answer #>> '{}'
          WHEN 'rent' THEN '임차' WHEN 'buy' THEN '구매'
          WHEN 'other' THEN '기타' ELSE '미정' END;
      ELSE
        v_old_answer_label := CASE jsonb_typeof(v_old_answer)
          WHEN 'boolean' THEN CASE WHEN (v_old_answer #>> '{}')::boolean
            THEN '해당' ELSE '아님' END
          ELSE '미정' END;
        v_new_answer_label := CASE jsonb_typeof(v_new_answer)
          WHEN 'boolean' THEN CASE WHEN (v_new_answer #>> '{}')::boolean
            THEN '해당' ELSE '아님' END
          ELSE '미정' END;
      END IF;
      v_segment := format(
        '%s %s→%s',
        v_answer_label,
        v_old_answer_label,
        v_new_answer_label
      );
      v_answer_segments := CASE
        WHEN v_answer_segments = '' THEN v_segment
        ELSE v_answer_segments || ', ' || v_segment
      END;
      v_answer_name_segments := CASE
        WHEN v_answer_name_segments = '' THEN v_answer_label
        ELSE v_answer_name_segments || ', ' || v_answer_label
      END;
    END LOOP;

    v_profile_summary := '상황 변경: ' || CASE
      WHEN v_answer_segments = '' THEN '답변 변경 없음'
      ELSE v_answer_segments
    END;
    v_summary := v_profile_summary || format(
      ' · 분야 제외%s/복원%s',
      v_category_excluded_count,
      v_category_restored_count
    );
    IF v_category_segments <> '' THEN
      v_summary := v_summary || '[' || v_category_segments || ']';
    END IF;
    v_summary := v_summary || format(
      ' · 항목 제외%s%s/복원%s%s · 자동 제외 총%s개',
      v_item_excluded_count,
      CASE WHEN v_item_excluded_segments = '' THEN ''
        ELSE '[' || v_item_excluded_segments || ']' END,
      v_item_restored_count,
      CASE WHEN v_item_restored_segments = '' THEN ''
        ELSE '[' || v_item_restored_segments || ']' END,
      v_profile_auto_count
    );
    IF v_structure_segments <> '' THEN
      v_summary := v_summary || format(
        ' · 목록 추가%s/문구%s[%s]',
        v_new_item_count,
        v_renamed_item_count,
        v_structure_segments
      );
    END IF;
    IF v_reviewed_count + v_review_cleared_count > 0 THEN
      v_summary := v_summary || format(
        ' · 검토 기록 추가%s%s/해제%s%s',
        v_reviewed_count,
        CASE WHEN v_reviewed_segments = '' THEN ''
          ELSE '[' || v_reviewed_segments || ']' END,
        v_review_cleared_count,
        CASE WHEN v_review_cleared_segments = '' THEN ''
          ELSE '[' || v_review_cleared_segments || ']' END
      );
    END IF;
    IF v_profile_reviewed_at_changed THEN
      v_summary := v_summary || ' · 검토시각 갱신';
    END IF;
    -- The proposal row keeps the complete structured progress patch. For a
    -- broad situation decision, repeat every affected label there and keep
    -- the notification receipt bounded, deterministic, and count-exact.
    -- This avoids blocking a legitimate 7-category/53-item ceremony choice
    -- while the partner still reviews every category and item before accept.
    IF char_length(v_summary) > 240 THEN
      v_summary := '상황: ' || CASE
        WHEN v_answer_segments = '' THEN '답변 변경 없음'
        ELSE v_answer_segments
      END || format(
        ' · 분야 제외%s/복원%s · 항목 제외%s/복원%s' ||
        ' · 목록 추가%s/문구%s · 검토 추가%s/해제%s' ||
        ' · 자동 제외%s',
        v_category_excluded_count,
        v_category_restored_count,
        v_item_excluded_count,
        v_item_restored_count,
        v_new_item_count,
        v_renamed_item_count,
        v_reviewed_count,
        v_review_cleared_count,
        v_profile_auto_count
      );
      IF v_profile_reviewed_at_changed THEN
        v_summary := v_summary || ' · 시각 갱신';
      END IF;
      v_summary := v_summary || ' · 상세 확인';
    END IF;
    IF char_length(v_summary) > 240 THEN
      v_summary := '상황 질문: ' || CASE
        WHEN v_answer_name_segments = '' THEN '답변 변경 없음'
        ELSE v_answer_name_segments
      END || format(
        ' · 분야 제외%s/복원%s · 항목 제외%s/복원%s' ||
        ' · 목록 추가%s/문구%s · 검토 추가%s/해제%s' ||
        ' · 자동 제외%s',
        v_category_excluded_count,
        v_category_restored_count,
        v_item_excluded_count,
        v_item_restored_count,
        v_new_item_count,
        v_renamed_item_count,
        v_reviewed_count,
        v_review_cleared_count,
        v_profile_auto_count
      );
      IF v_profile_reviewed_at_changed THEN
        v_summary := v_summary || ' · 시각 갱신';
      END IF;
      v_summary := v_summary || ' · 상세 확인';
    END IF;
  ELSE
    IF v_assignee_count > 0 AND (
         v_category_excluded_count + v_category_restored_count
         + v_item_excluded_count + v_item_restored_count > 0
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;
    IF v_category_excluded_count + v_category_restored_count > 0 THEN
      v_summary := '체크리스트 범위: ' || v_category_segments;
    END IF;
    IF v_item_excluded_count + v_item_restored_count > 0 THEN
      v_summary := v_summary || CASE WHEN v_summary = '' THEN '' ELSE ' · ' END
        || format(
        '항목 %s개 제외/%s개 복원 (%s)',
        v_item_excluded_count,
        v_item_restored_count,
        v_item_segments
      );
    END IF;
    IF v_new_item_count + v_renamed_item_count > 0 THEN
      v_summary := v_summary || format(
        ' · 목록 동기화: 추가 %s개/문구 변경 %s개 (%s)',
        v_new_item_count,
        v_renamed_item_count,
        v_structure_segments
      );
    END IF;
    IF v_status_repair_count > 0 THEN
      v_summary := v_summary || format(
        ' · 상태 보정 %s개 (%s)',
        v_status_repair_count,
        v_status_repair_segments
      );
    END IF;
    IF v_reviewed_count > 0 THEN
      v_summary := v_summary || format(
        ' · 검토 기록 %s개 분야[%s]',
        v_reviewed_count,
        v_reviewed_segments
      );
    END IF;
    -- A real template upgrade can add several items at once. The proposal
    -- keeps every item and assignee in structured form, so a status-repair
    -- receipt may compact only the already validated structural details to
    -- exact counts. Oversized ordinary materialization still fails closed.
    IF char_length(v_summary) > 240 AND v_status_repair_count > 0 THEN
      v_summary := format(
        '체크리스트 담당 결정%s건 · 목록 추가%s/문구%s' ||
        ' · 상태 보정%s건 (%s) · 상세 확인',
        v_assignee_count,
        v_new_item_count,
        v_renamed_item_count,
        v_status_repair_count,
        v_status_repair_segments
      );
    END IF;
    IF char_length(v_summary) > 240 AND v_status_repair_count > 0 THEN
      v_summary := format(
        '체크리스트 담당 결정%s건 · 목록 추가%s/문구%s' ||
        ' · 상태 보정%s건(완료→진행 중) · 상세 확인',
        v_assignee_count,
        v_new_item_count,
        v_renamed_item_count,
        v_status_repair_count
      );
    END IF;
  END IF;
  IF v_summary = ''
     OR char_length(v_summary) > 240
     OR public.couple_plan_change_has_unsafe_display_text(v_summary) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_SUMMARY_TOO_LONG'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_summary;
END;
$function$;

ALTER FUNCTION public.couple_plan_checklist_safe_label(text, text, integer)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_checklist_assignee_label(
  jsonb, uuid, uuid, boolean
)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_checklist_collaboration_projection(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_checklist_profile_is_valid(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.couple_plan_checklist_safe_label(
  text, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_checklist_assignee_label(
  jsonb, uuid, uuid, boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_checklist_collaboration_projection(
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_checklist_profile_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.couple_plan_change_is_high_impact_before_checklist(
    date, date, text, text, bigint, bigint, jsonb, jsonb
  ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.couple_plan_change_exact_high_summary_before_checklist(
    date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
  ) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) IS 'Treats nested checklist responsibility and whole-category applicability changes as shared high-impact decisions.';
COMMENT ON FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) IS 'Builds a bounded Korean checklist collaboration receipt and rejects undisclosed mixed deltas.';

CREATE OR REPLACE FUNCTION public.scrub_departing_checklist_member_refs(
  p_progress jsonb,
  p_departing_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_category jsonb;
  v_checklist jsonb;
BEGIN
  IF jsonb_typeof(COALESCE(p_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object'
     OR p_departing_profile_id IS NULL THEN
    RETURN p_progress;
  END IF;

  FOR v_key, v_category IN
    SELECT item.key, item.value
    FROM jsonb_each(COALESCE(p_progress, '{}'::jsonb)) AS item(key, value)
    ORDER BY item.key
  LOOP
    IF jsonb_typeof(v_category) = 'object'
       AND v_category ->> 'checklistReviewedByProfileId' =
         p_departing_profile_id::text THEN
      v_category := v_category - 'checklistReviewedByProfileId';
    END IF;
    IF jsonb_typeof(v_category) = 'object'
       AND jsonb_typeof(v_category -> 'checklist') = 'array' THEN
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN jsonb_typeof(checklist_item.value) <> 'object' THEN
              checklist_item.value
            ELSE
              (
                CASE
                  WHEN checklist_item.value #>> '{assignee,kind}' = 'member'
                   AND checklist_item.value #>> '{assignee,profileId}' =
                     p_departing_profile_id::text
                    THEN checklist_item.value - 'assignee'
                  ELSE checklist_item.value
                END
              ) - CASE
                WHEN checklist_item.value ->> 'completedByProfileId' =
                     p_departing_profile_id::text
                  THEN ARRAY['completedByProfileId', 'completedAt']::text[]
                ELSE '{}'::text[]
              END
          END
          ORDER BY checklist_item.position
        ),
        '[]'::jsonb
      )
      INTO v_checklist
      FROM jsonb_array_elements(v_category -> 'checklist')
        WITH ORDINALITY AS checklist_item(value, position);
      v_category := jsonb_set(
        v_category,
        '{checklist}',
        v_checklist,
        false
      );
    END IF;
    v_result := v_result || jsonb_build_object(v_key, v_category);
  END LOOP;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.scrub_non_roster_checklist_member_refs(
  p_progress jsonb,
  p_bride_id uuid,
  p_groom_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_category jsonb;
  v_checklist jsonb;
BEGIN
  IF jsonb_typeof(COALESCE(p_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object' THEN
    RETURN p_progress;
  END IF;

  FOR v_key, v_category IN
    SELECT item.key, item.value
    FROM jsonb_each(COALESCE(p_progress, '{}'::jsonb)) AS item(key, value)
    ORDER BY item.key
  LOOP
    IF jsonb_typeof(v_category) = 'object'
       AND v_category ? 'checklistReviewedByProfileId'
       AND (
         v_category ->> 'checklistReviewedByProfileId' IS DISTINCT FROM
           COALESCE(p_bride_id::text, '')
         AND v_category ->> 'checklistReviewedByProfileId' IS DISTINCT FROM
           COALESCE(p_groom_id::text, '')
       ) THEN
      v_category := v_category - 'checklistReviewedByProfileId';
    END IF;
    IF jsonb_typeof(v_category) = 'object'
       AND jsonb_typeof(v_category -> 'checklist') = 'array' THEN
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN jsonb_typeof(checklist_item.value) <> 'object' THEN
              checklist_item.value
            ELSE
              (
                CASE
                  WHEN checklist_item.value #>> '{assignee,kind}' = 'member'
                   AND checklist_item.value #>> '{assignee,profileId}'
                     IS DISTINCT FROM COALESCE(p_bride_id::text, '')
                   AND checklist_item.value #>> '{assignee,profileId}'
                     IS DISTINCT FROM COALESCE(p_groom_id::text, '')
                    THEN checklist_item.value - 'assignee'
                  ELSE checklist_item.value
                END
              ) - CASE
                WHEN checklist_item.value ? 'completedByProfileId'
                 AND checklist_item.value ->> 'completedByProfileId'
                   IS DISTINCT FROM COALESCE(p_bride_id::text, '')
                 AND checklist_item.value ->> 'completedByProfileId'
                   IS DISTINCT FROM COALESCE(p_groom_id::text, '')
                  THEN ARRAY['completedByProfileId', 'completedAt']::text[]
                ELSE '{}'::text[]
              END
          END
          ORDER BY checklist_item.position
        ),
        '[]'::jsonb
      )
      INTO v_checklist
      FROM jsonb_array_elements(v_category -> 'checklist')
        WITH ORDINALITY AS checklist_item(value, position);
      v_category := jsonb_set(v_category, '{checklist}', v_checklist, false);
    END IF;
    v_result := v_result || jsonb_build_object(v_key, v_category);
  END LOOP;
  RETURN v_result;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.couple_reset_checklist_scrub_claims (
  nonce uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('membership_reset', 'migration_backfill')),
  actor_user_id uuid,
  retained_bride_id uuid,
  retained_groom_id uuid,
  base_revision bigint NOT NULL CHECK (
    base_revision BETWEEN 0 AND 9007199254740990
  ),
  expected_progress jsonb NOT NULL CHECK (
    jsonb_typeof(expected_progress) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (
      reason = 'membership_reset'
      AND actor_user_id IS NOT NULL
      AND retained_bride_id IS NULL
      AND retained_groom_id IS NULL
    )
    OR (
      reason = 'migration_backfill'
      AND actor_user_id IS NULL
    )
  )
);

ALTER TABLE public.couple_reset_checklist_scrub_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.couple_reset_checklist_scrub_claims
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the established Amora/manual-plan authorization branches byte-for-byte
-- equivalent, with one narrow reset branch backed by a server-owned one-use
-- claim. A client-created GUC is insufficient without the matching locked row.
CREATE OR REPLACE FUNCTION public.enforce_couple_plan_change_write_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_amora_couple text := NULLIF(current_setting(
    'hanbang.amora_shared_action_couple_id', true
  ), '');
  v_amora_request text := NULLIF(current_setting(
    'hanbang.amora_shared_action_request_key', true
  ), '');
  v_amora_operation text := NULLIF(current_setting(
    'hanbang.amora_shared_action_operation_key', true
  ), '');
  v_amora_action text := NULLIF(current_setting(
    'hanbang.amora_shared_action_action_id', true
  ), '');
  v_amora_revision text := NULLIF(current_setting(
    'hanbang.amora_shared_action_expected_revision', true
  ), '');
  v_plan_request text := NULLIF(current_setting(
    'hanbang.couple_plan_change_request_id', true
  ), '');
  v_plan_couple text := NULLIF(current_setting(
    'hanbang.couple_plan_change_couple_id', true
  ), '');
  v_plan_revision text := NULLIF(current_setting(
    'hanbang.couple_plan_change_base_revision', true
  ), '');
  v_plan_digest text := NULLIF(current_setting(
    'hanbang.couple_plan_change_digest', true
  ), '');
  v_reset_nonce text := NULLIF(current_setting(
    'hanbang.couple_reset_checklist_scrub_nonce', true
  ), '');
  v_reset_claim public.couple_reset_checklist_scrub_claims%ROWTYPE;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_expected_date date;
  v_expected_venue text;
  v_expected_budget bigint;
  v_expected_progress jsonb;
  v_remove_keys text[];
  v_rows integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.wedding_date IS NOT NULL
       OR NEW.venue IS NOT NULL
       OR COALESCE(NEW.total_budget, 0) <> 0
       OR COALESCE(NEW.progress, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF v_reset_nonce IS NOT NULL THEN
    IF v_reset_nonce !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_DENIED'
        USING ERRCODE = '42501';
    END IF;

    SELECT claim.*
    INTO v_reset_claim
    FROM public.couple_reset_checklist_scrub_claims AS claim
    WHERE claim.nonce = v_reset_nonce::uuid
    FOR UPDATE;

    IF NOT FOUND
       OR v_reset_claim.couple_id IS DISTINCT FROM OLD.couple_id
       OR v_reset_claim.base_revision IS DISTINCT FROM OLD.state_revision
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
       OR NEW.state_revision IS DISTINCT FROM OLD.state_revision
       OR NEW.wedding_date IS DISTINCT FROM OLD.wedding_date
       OR NEW.venue IS DISTINCT FROM OLD.venue
       OR NEW.total_budget IS DISTINCT FROM OLD.total_budget
       OR NEW.progress IS DISTINCT FROM v_reset_claim.expected_progress THEN
      RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_CONFLICT'
        USING ERRCODE = '40001';
    END IF;

    IF v_reset_claim.reason = 'membership_reset' THEN
      IF auth.role() IS DISTINCT FROM 'authenticated'
         OR auth.uid() IS NULL
         OR v_reset_claim.actor_user_id IS DISTINCT FROM auth.uid()
         OR v_reset_claim.expected_progress IS DISTINCT FROM
           public.scrub_departing_checklist_member_refs(
             OLD.progress,
             v_reset_claim.actor_user_id
           ) THEN
        RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_DENIED'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_reset_claim.reason = 'migration_backfill' THEN
      IF v_reset_claim.actor_user_id IS NOT NULL
         OR v_reset_claim.expected_progress IS DISTINCT FROM
           public.scrub_non_roster_checklist_member_refs(
             OLD.progress,
             v_reset_claim.retained_bride_id,
             v_reset_claim.retained_groom_id
           ) THEN
        RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_DENIED'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_DENIED'
        USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.couple_reset_checklist_scrub_claims AS claim
    WHERE claim.nonce = v_reset_claim.nonce;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_CONFLICT'
        USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.couple_plan_change_is_high_impact(
    OLD.wedding_date,
    NEW.wedding_date,
    OLD.venue,
    NEW.venue,
    OLD.total_budget,
    NEW.total_budget,
    OLD.progress,
    NEW.progress
  ) THEN
    RETURN NEW;
  END IF;

  IF v_amora_couple IS NOT NULL
     AND v_amora_request IS NOT NULL
     AND v_amora_operation IS NOT NULL
     AND v_amora_action IS NOT NULL
     AND v_amora_revision IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_plan_request IS NULL
     OR v_plan_couple IS NULL
     OR v_plan_revision IS NULL
     OR v_plan_digest IS NULL
     OR v_plan_request !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_plan_couple IS DISTINCT FROM OLD.couple_id::text
     OR v_plan_revision !~ '^(0|[1-9][0-9]{0,15})$'
     OR v_plan_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = OLD.couple_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, OLD.couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, OLD.couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;

  IF v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id = v_groom_id THEN
    RETURN NEW;
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = v_plan_request::uuid
    AND request.couple_id = OLD.couple_id
    AND request.base_revision = v_plan_revision::bigint
    AND request.change_digest = v_plan_digest
    AND request.status = 'applying';

  v_roster_fingerprint := md5(
    v_bride_id::text || ':' || v_groom_id::text
  );

  IF NOT FOUND
     OR v_request.is_high_impact IS DISTINCT FROM true
     OR v_request.required_count <> 2
     OR v_request.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_request.change_digest IS DISTINCT FROM
       public.couple_plan_change_digest(v_request.changes)
     OR OLD.state_revision IS DISTINCT FROM v_request.base_revision
     OR v_request.applied_at IS NOT NULL
     OR v_request.applied_revision IS NOT NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(
      v_request.changes -> 'progress_remove_keys',
      '[]'::jsonb
    )
  ) AS item(key);

  v_expected_date := CASE
    WHEN v_request.changes ? 'wedding_date'
      THEN (v_request.changes ->> 'wedding_date')::date
    ELSE OLD.wedding_date
  END;
  v_expected_venue := CASE
    WHEN v_request.changes ? 'venue'
      THEN v_request.changes ->> 'venue'
    ELSE OLD.venue
  END;
  v_expected_budget := CASE
    WHEN v_request.changes ? 'total_budget'
      THEN (v_request.changes ->> 'total_budget')::bigint
    ELSE OLD.total_budget
  END;
  v_expected_progress := (
    COALESCE(OLD.progress, '{}'::jsonb) - v_remove_keys
  ) || COALESCE(
    v_request.changes -> 'progress_patch',
    '{}'::jsonb
  );

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
     OR NEW.state_revision IS DISTINCT FROM OLD.state_revision
     OR NEW.wedding_date IS DISTINCT FROM v_expected_date
     OR NEW.venue IS DISTINCT FROM v_expected_venue
     OR NEW.total_budget IS DISTINCT FROM v_expected_budget
     OR NEW.progress IS DISTINCT FROM v_expected_progress THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enforce_couple_plan_change_write_boundary()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_couple_plan_change_write_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_00_enforce_couple_plan_change_write_boundary
  ON public.wedding_journeys;
CREATE TRIGGER trg_00_enforce_couple_plan_change_write_boundary
  BEFORE INSERT OR UPDATE ON public.wedding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_couple_plan_change_write_boundary();

-- One-time cleanup for legacy nested UUIDs that no longer belong to the
-- current couple roster. Each affected journey uses the same one-use claim and
-- ordinary revision trigger as runtime reset, then invalidates old-revision
-- approvals. No user trigger or constraint is disabled.
DO $backfill$
DECLARE
  v_row record;
  v_bride_id uuid;
  v_groom_id uuid;
  v_scrubbed_progress jsonb;
  v_nonce uuid;
  v_rows integer;
  v_request_id uuid;
  v_notification_actor uuid;
  v_previous_claim_role text;
BEGIN
  FOR v_row IN
    SELECT journey.id,
           journey.couple_id,
           journey.progress,
           journey.state_revision,
           couple.bride_id,
           couple.groom_id
    FROM public.wedding_journeys AS journey
    JOIN public.couples AS couple ON couple.id = journey.couple_id
    ORDER BY journey.couple_id
    FOR UPDATE OF couple, journey
  LOOP
    v_bride_id := CASE
      WHEN public.is_current_couple_member(
        v_row.bride_id, v_row.couple_id
      ) THEN v_row.bride_id
      ELSE NULL
    END;
    v_groom_id := CASE
      WHEN public.is_current_couple_member(
        v_row.groom_id, v_row.couple_id
      ) THEN v_row.groom_id
      ELSE NULL
    END;
    v_scrubbed_progress := public.scrub_non_roster_checklist_member_refs(
      v_row.progress,
      v_bride_id,
      v_groom_id
    );
    IF v_scrubbed_progress IS NOT DISTINCT FROM v_row.progress THEN
      CONTINUE;
    END IF;

    INSERT INTO public.couple_reset_checklist_scrub_claims(
      couple_id,
      reason,
      actor_user_id,
      retained_bride_id,
      retained_groom_id,
      base_revision,
      expected_progress
    ) VALUES (
      v_row.couple_id,
      'migration_backfill',
      NULL,
      v_bride_id,
      v_groom_id,
      v_row.state_revision,
      v_scrubbed_progress
    )
    RETURNING nonce INTO v_nonce;

    PERFORM pg_catalog.set_config(
      'hanbang.couple_reset_checklist_scrub_nonce',
      v_nonce::text,
      true
    );
    BEGIN
      UPDATE public.wedding_journeys AS journey
      SET progress = v_scrubbed_progress
      WHERE journey.id = v_row.id
        AND journey.couple_id = v_row.couple_id
        AND journey.state_revision = v_row.state_revision;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      PERFORM pg_catalog.set_config(
        'hanbang.couple_reset_checklist_scrub_nonce', '', true
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_catalog.set_config(
        'hanbang.couple_reset_checklist_scrub_nonce', '', true
      );
      RAISE;
    END;
    IF v_rows <> 1 OR EXISTS (
      SELECT 1
      FROM public.couple_reset_checklist_scrub_claims AS claim
      WHERE claim.nonce = v_nonce
    ) THEN
      RAISE EXCEPTION 'CHECKLIST_MEMBER_REF_BACKFILL_CONFLICT'
        USING ERRCODE = '40001';
    END IF;

    v_notification_actor := COALESCE(v_bride_id, v_groom_id);
    v_previous_claim_role := current_setting(
      'request.jwt.claim.role', true
    );
    FOR v_request_id IN
      UPDATE public.couple_plan_change_requests AS request
      SET status = 'stale',
          stale_at = clock_timestamp(),
          stale_reason = 'revision_changed'
      WHERE request.couple_id = v_row.couple_id
        AND request.status = 'pending'
      RETURNING request.id
    LOOP
      IF v_notification_actor IS NOT NULL THEN
        BEGIN
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.role', 'service_role', true
          );
          PERFORM public.finalize_couple_plan_change_notifications_locked(
            v_request_id,
            v_notification_actor,
            'change_stale'
          );
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.role', COALESCE(v_previous_claim_role, ''), true
          );
        EXCEPTION WHEN OTHERS THEN
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.role', COALESCE(v_previous_claim_role, ''), true
          );
          RAISE;
        END;
      END IF;
    END LOOP;
  END LOOP;
END
$backfill$;

-- Replace the original atomic reset with a checklist-aware version. The
-- one-use claim above lets the ordinary revision trigger advance exactly once;
-- no triggers or constraints are disabled during the privacy scrub.
CREATE OR REPLACE FUNCTION public.reset_current_couple_membership()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_couple_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_progress jsonb;
  v_scrubbed_progress jsonb;
  v_state_revision bigint;
  v_scrub_nonce uuid;
  v_previous_claim_role text;
  v_request_id uuid;
  v_rows integer;
BEGIN
  IF v_user_id IS NULL
     OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id
  INTO v_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.set_config('hanbang.allow_membership_write', 'on', true);

  IF v_couple_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_couple_id::text, 0)
    );

    SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
    FROM public.couples AS couple
    WHERE couple.id = v_couple_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_bride_id IS DISTINCT FROM v_user_id
         AND v_groom_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'membership_inconsistent' USING ERRCODE = 'P0001';
      END IF;

      SELECT journey.progress, journey.state_revision
      INTO v_progress, v_state_revision
      FROM public.wedding_journeys AS journey
      WHERE journey.couple_id = v_couple_id
      FOR UPDATE;

      IF FOUND THEN
        v_scrubbed_progress := public.scrub_departing_checklist_member_refs(
          v_progress,
          v_user_id
        );
        IF v_scrubbed_progress IS DISTINCT FROM v_progress THEN
          INSERT INTO public.couple_reset_checklist_scrub_claims(
            couple_id,
            reason,
            actor_user_id,
            base_revision,
            expected_progress
          ) VALUES (
            v_couple_id,
            'membership_reset',
            v_user_id,
            v_state_revision,
            v_scrubbed_progress
          )
          RETURNING nonce INTO v_scrub_nonce;
          PERFORM pg_catalog.set_config(
            'hanbang.couple_reset_checklist_scrub_nonce',
            v_scrub_nonce::text,
            true
          );
          BEGIN
            UPDATE public.wedding_journeys AS journey
            SET progress = v_scrubbed_progress
            WHERE journey.couple_id = v_couple_id
              AND journey.state_revision = v_state_revision;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            PERFORM pg_catalog.set_config(
              'hanbang.couple_reset_checklist_scrub_nonce', '', true
            );
          EXCEPTION WHEN OTHERS THEN
            PERFORM pg_catalog.set_config(
              'hanbang.couple_reset_checklist_scrub_nonce', '', true
            );
            RAISE;
          END;
          IF v_rows <> 1 THEN
            RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_CONFLICT'
              USING ERRCODE = '40001';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM public.couple_reset_checklist_scrub_claims AS claim
            WHERE claim.nonce = v_scrub_nonce
          ) THEN
            RAISE EXCEPTION 'COUPLE_RESET_CHECKLIST_SCRUB_CONFLICT'
              USING ERRCODE = '40001';
          END IF;
        END IF;
      END IF;

      -- A roster-bound approval cannot survive a member departure. Convert
      -- every pending request before the couple slot changes, while the
      -- departing actor is still a current member for notification cleanup.
      v_previous_claim_role := current_setting(
        'request.jwt.claim.role', true
      );
      FOR v_request_id IN
        UPDATE public.couple_plan_change_requests AS request
        SET status = 'stale',
            stale_at = clock_timestamp(),
            stale_reason = 'roster_changed'
        WHERE request.couple_id = v_couple_id
          AND request.status = 'pending'
        RETURNING request.id
      LOOP
        BEGIN
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.role', 'service_role', true
          );
          PERFORM public.finalize_couple_plan_change_notifications_locked(
            v_request_id,
            v_user_id,
            'change_stale'
          );
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.role', COALESCE(v_previous_claim_role, ''), true
          );
        EXCEPTION WHEN OTHERS THEN
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.role', COALESCE(v_previous_claim_role, ''), true
          );
          RAISE;
        END;
      END LOOP;

      UPDATE public.couples
      SET bride_id = CASE WHEN bride_id = v_user_id THEN NULL ELSE bride_id END,
          groom_id = CASE WHEN groom_id = v_user_id THEN NULL ELSE groom_id END,
          updated_at = now()
      WHERE id = v_couple_id;
    END IF;
  END IF;

  UPDATE public.profiles
  SET couple_id = NULL,
      onboarding_completed = false,
      onboarding_step = 1,
      shared_chat_cleared_at = NULL,
      private_chat_cleared_at = NULL,
      updated_at = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'previous_couple_id', v_couple_id
  );
END;
$function$;

ALTER FUNCTION public.scrub_departing_checklist_member_refs(jsonb, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.scrub_non_roster_checklist_member_refs(
  jsonb, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.reset_current_couple_membership() OWNER TO postgres;
ALTER TABLE public.couple_reset_checklist_scrub_claims OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scrub_departing_checklist_member_refs(
  jsonb, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scrub_non_roster_checklist_member_refs(
  jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reset_current_couple_membership()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reset_current_couple_membership()
  TO authenticated;

COMMENT ON FUNCTION public.scrub_departing_checklist_member_refs(jsonb, uuid)
  IS 'Removes a departing member from nested checklist assignment and completion audit references without changing task state.';
COMMENT ON FUNCTION public.scrub_non_roster_checklist_member_refs(
  jsonb, uuid, uuid
) IS 'One-time migration helper that removes nested checklist UUIDs outside the current couple roster without changing task state.';
COMMENT ON FUNCTION public.reset_current_couple_membership()
  IS 'Atomically detaches auth.uid(), scrubs nested checklist member references, invalidates roster-bound approvals, and resets onboarding.';

COMMIT;
