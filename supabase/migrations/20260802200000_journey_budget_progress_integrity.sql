BEGIN;

-- Preserve the reviewed schedule-aware wrappers and place the budget
-- integrity fence in front of the public service-only entry point.
DO $block$
BEGIN
  IF to_regprocedure(
       'public.submit_couple_plan_change_before_budget_integrity(uuid,uuid,bigint,jsonb,text,text)'
     ) IS NULL
     AND to_regprocedure(
       'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)'
     ) IS NOT NULL THEN
    ALTER FUNCTION public.submit_couple_plan_change(
      uuid, uuid, bigint, jsonb, text, text
    ) RENAME TO submit_couple_plan_change_before_budget_integrity;
  END IF;

  IF to_regprocedure(
       'public.couple_plan_change_is_high_impact_before_spent(date,date,text,text,bigint,bigint,jsonb,jsonb)'
     ) IS NULL
     AND to_regprocedure(
       'public.couple_plan_change_is_high_impact(date,date,text,text,bigint,bigint,jsonb,jsonb)'
     ) IS NOT NULL THEN
    ALTER FUNCTION public.couple_plan_change_is_high_impact(
      date, date, text, text, bigint, bigint, jsonb, jsonb
    ) RENAME TO couple_plan_change_is_high_impact_before_spent;
  END IF;

  IF to_regprocedure(
       'public.couple_plan_change_exact_high_summary_before_spent(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
     ) IS NULL
     AND to_regprocedure(
       'public.couple_plan_change_exact_high_summary(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
     ) IS NOT NULL THEN
    ALTER FUNCTION public.couple_plan_change_exact_high_summary(
      date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
    ) RENAME TO couple_plan_change_exact_high_summary_before_spent;
  END IF;
END
$block$;

CREATE OR REPLACE FUNCTION public.assert_couple_plan_budget_progress_patch(
  p_changes jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_patch jsonb;
  v_key text;
  v_item jsonb;
  v_field text;
  v_amount numeric;
  v_budget_like boolean;
BEGIN
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
     OR NOT (p_changes ? 'progress_patch') THEN
    RETURN;
  END IF;

  v_patch := p_changes -> 'progress_patch';
  IF jsonb_typeof(v_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_item IN
    SELECT item.key, item.value
    FROM jsonb_each(v_patch) AS item(key, value)
  LOOP
    v_budget_like := v_key = ANY (ARRAY[
      'meeting', 'venue', 'studio', 'dress', 'makeup', 'snap',
      'ring', 'yedan', 'hanbok', 'shoes', 'bouquet', 'honeymoon',
      'houseware', 'housing', 'invitation', 'gift', 'mc', 'ham',
      'pyebaek', 'reserve',
      'budget', 'spent', 'payer', 'category', 'label'
    ]::text[])
      OR (
        jsonb_typeof(v_item) = 'object'
        AND v_item ?| ARRAY[
          'budget', 'spent', 'payer', 'category', 'label'
        ]::text[]
      );

    IF NOT v_budget_like THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
        USING ERRCODE = '22023';
    END IF;

    FOREACH v_field IN ARRAY ARRAY['budget', 'spent']::text[]
    LOOP
      IF NOT (v_item ? v_field) THEN
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_item -> v_field) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_amount := (v_item ->> v_field)::numeric;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
          USING ERRCODE = '22023';
      END;
      IF v_amount <> trunc(v_amount)
         OR v_amount < 0
         OR v_amount > 1000000000 THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    IF v_item ? 'payer'
       AND (
         jsonb_typeof(v_item -> 'payer') IS DISTINCT FROM 'string'
         OR v_item ->> 'payer' NOT IN (
           'couple', 'bride_parents', 'groom_parents', 'both_parents'
         )
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
        USING ERRCODE = '22023';
    END IF;

    IF v_item ? 'category'
       AND (
         jsonb_typeof(v_item -> 'category') IS DISTINCT FROM 'string'
         OR v_item ->> 'category' IS DISTINCT FROM v_key
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
        USING ERRCODE = '22023';
    END IF;

    IF v_item ? 'label'
       AND (
         jsonb_typeof(v_item -> 'label') IS DISTINCT FROM 'string'
         OR char_length(btrim(v_item ->> 'label')) NOT BETWEEN 1 AND 200
         OR public.couple_plan_change_has_unsafe_display_text(
           v_item ->> 'label'
         )
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.couple_plan_change_strip_spent(
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
  v_item jsonb;
BEGIN
  IF jsonb_typeof(COALESCE(p_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object' THEN
    RETURN p_progress;
  END IF;
  FOR v_key, v_item IN
    SELECT item.key, item.value
    FROM jsonb_each(COALESCE(p_progress, '{}'::jsonb)) AS item(key, value)
  LOOP
    v_result := v_result || jsonb_build_object(
      v_key,
      CASE
        WHEN jsonb_typeof(v_item) = 'object' THEN v_item - 'spent'
        ELSE v_item
      END
    );
  END LOOP;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.couple_plan_change_budget_amount_label(
  p_value jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_amount numeric;
BEGIN
  IF p_value IS NULL OR p_value = 'null'::jsonb THEN
    RETURN '미정';
  END IF;
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
    RETURN '확인 필요';
  END IF;
  BEGIN
    v_amount := p_value::text::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN '확인 필요';
  END;
  IF v_amount <> trunc(v_amount)
     OR v_amount < 0
     OR v_amount > 1000000000 THEN
    RETURN '확인 필요';
  END IF;
  RETURN trunc(v_amount)::text || '원';
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
  v_key text;
BEGIN
  IF jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb)) = 'object'
     AND jsonb_typeof(COALESCE(p_new_progress, '{}'::jsonb)) = 'object' THEN
    FOR v_key IN
      SELECT old_key.key
      FROM jsonb_object_keys(
        COALESCE(p_old_progress, '{}'::jsonb)
      ) AS old_key(key)
      UNION
      SELECT new_key.key
      FROM jsonb_object_keys(
        COALESCE(p_new_progress, '{}'::jsonb)
      ) AS new_key(key)
    LOOP
      IF (p_old_progress -> v_key -> 'spent') IS DISTINCT FROM
           (p_new_progress -> v_key -> 'spent') THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;

  RETURN public.couple_plan_change_is_high_impact_before_spent(
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
  v_has_spent_delta boolean := false;
  v_key text;
  v_old_without_spent jsonb;
  v_new_without_spent jsonb;
  v_old_residual jsonb;
  v_new_residual jsonb;
  v_summary text := '';
  v_segment text;
  v_category_label text;
BEGIN
  IF jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb)) = 'object'
     AND jsonb_typeof(COALESCE(p_new_progress, '{}'::jsonb)) = 'object' THEN
    FOR v_key IN
      SELECT old_key.key
      FROM jsonb_object_keys(
        COALESCE(p_old_progress, '{}'::jsonb)
      ) AS old_key(key)
      UNION
      SELECT new_key.key
      FROM jsonb_object_keys(
        COALESCE(p_new_progress, '{}'::jsonb)
      ) AS new_key(key)
    LOOP
      IF (p_old_progress -> v_key -> 'spent') IS DISTINCT FROM
           (p_new_progress -> v_key -> 'spent') THEN
        v_has_spent_delta := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_has_spent_delta THEN
    RETURN public.couple_plan_change_exact_high_summary_before_spent(
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

  IF (COALESCE(p_old_progress, '{}'::jsonb) -> '__events')
       IS DISTINCT FROM
     (COALESCE(p_new_progress, '{}'::jsonb) -> '__events') THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
      USING ERRCODE = '22023';
  END IF;

  -- A linked approval must not hide a routine status/checklist mutation
  -- behind the exact spend amount that the partner sees.
  FOR v_key IN
    SELECT old_key.key
    FROM jsonb_object_keys(
      COALESCE(p_old_progress, '{}'::jsonb)
    ) AS old_key(key)
    WHERE old_key.key <> '__events'
    UNION
    SELECT new_key.key
    FROM jsonb_object_keys(
      COALESCE(p_new_progress, '{}'::jsonb)
    ) AS new_key(key)
    WHERE new_key.key <> '__events'
  LOOP
    v_old_residual := p_old_progress -> v_key;
    v_new_residual := p_new_progress -> v_key;
    IF jsonb_typeof(v_old_residual) = 'object' THEN
      v_old_residual := v_old_residual - ARRAY[
        'budget', 'spent', 'payer', 'responsibility', 'assigned_to'
      ]::text[];
      IF v_old_residual = '{}'::jsonb THEN
        v_old_residual := NULL;
      END IF;
    END IF;
    IF jsonb_typeof(v_new_residual) = 'object' THEN
      v_new_residual := v_new_residual - ARRAY[
        'budget', 'spent', 'payer', 'responsibility', 'assigned_to'
      ]::text[];
      IF v_new_residual = '{}'::jsonb THEN
        v_new_residual := NULL;
      END IF;
    END IF;
    IF v_old_residual IS DISTINCT FROM v_new_residual THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_old_without_spent := public.couple_plan_change_strip_spent(
    p_old_progress
  );
  v_new_without_spent := public.couple_plan_change_strip_spent(
    p_new_progress
  );
  IF public.couple_plan_change_is_high_impact_before_spent(
       p_old_wedding_date,
       p_new_wedding_date,
       p_old_venue,
       p_new_venue,
       p_old_total_budget,
       p_new_total_budget,
       v_old_without_spent,
       v_new_without_spent
     ) THEN
    v_summary := public.couple_plan_change_exact_high_summary_before_spent(
      p_old_wedding_date,
      p_new_wedding_date,
      p_old_venue,
      p_new_venue,
      p_old_total_budget,
      p_new_total_budget,
      v_old_without_spent,
      v_new_without_spent,
      p_bride_id,
      p_groom_id
    );
  END IF;

  FOR v_key IN
    SELECT old_key.key
    FROM jsonb_object_keys(
      COALESCE(p_old_progress, '{}'::jsonb)
    ) AS old_key(key)
    UNION
    SELECT new_key.key
    FROM jsonb_object_keys(
      COALESCE(p_new_progress, '{}'::jsonb)
    ) AS new_key(key)
    ORDER BY 1
  LOOP
    IF (p_old_progress -> v_key -> 'spent') IS NOT DISTINCT FROM
         (p_new_progress -> v_key -> 'spent') THEN
      CONTINUE;
    END IF;
    v_category_label := COALESCE(
      NULLIF(p_new_progress -> v_key ->> 'label', ''),
      NULLIF(p_old_progress -> v_key ->> 'label', ''),
      NULLIF(p_new_progress -> v_key ->> 'category', ''),
      NULLIF(p_old_progress -> v_key ->> 'category', ''),
      v_key
    );
    IF char_length(btrim(v_category_label)) NOT BETWEEN 1 AND 40
       OR public.couple_plan_change_has_unsafe_display_text(
         v_category_label
       ) THEN
      v_category_label := v_key;
    END IF;
    v_segment := format(
      '%s 지출: %s → %s',
      v_category_label,
      public.couple_plan_change_budget_amount_label(
        p_old_progress -> v_key -> 'spent'
      ),
      public.couple_plan_change_budget_amount_label(
        p_new_progress -> v_key -> 'spent'
      )
    );
    v_summary := CASE
      WHEN v_summary = '' THEN v_segment
      ELSE v_summary || ' · ' || v_segment
    END;
  END LOOP;

  IF char_length(v_summary) NOT BETWEEN 1 AND 240
     OR public.couple_plan_change_has_unsafe_display_text(v_summary) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_SUMMARY_TOO_LONG'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_summary;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_couple_plan_change(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_expected_revision bigint,
  p_changes jsonb,
  p_surface text,
  p_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
BEGIN
  PERFORM public.assert_couple_plan_budget_progress_patch(p_changes);
  RETURN public.submit_couple_plan_change_before_budget_integrity(
    p_couple_id,
    p_actor_user_id,
    p_expected_revision,
    p_changes,
    p_surface,
    p_summary
  );
END;
$function$;

ALTER FUNCTION public.assert_couple_plan_budget_progress_patch(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_strip_spent(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_budget_amount_label(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_couple_plan_budget_progress_patch(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_strip_spent(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_budget_amount_label(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_couple_plan_change_before_budget_integrity(
  uuid, uuid, bigint, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) TO service_role;

COMMENT ON FUNCTION public.assert_couple_plan_budget_progress_patch(jsonb)
  IS 'Validates service-submitted budget progress records without reinterpreting unrelated progress domains.';
COMMENT ON FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) IS 'Treats an exact spent amount delta as a shared high-impact decision.';
COMMENT ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) IS 'Service-only plan change entry point with budget progress integrity validation.';

COMMIT;
