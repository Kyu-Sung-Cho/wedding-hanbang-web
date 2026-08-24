-- 20260824160000: 처음 넣는 예산이 "두 가지 변경"으로 거절되던 것을 고친다.
--
-- 사용자가 겪는 모양:
--
--     예산 화면에서 "예식장 예산 2,000만원" 입력
--     → "날짜·예산·식장 같은 공동 결정과 준비 현황 변경을 나누어 저장해 주세요."
--     → 아무것도 저장되지 않음
--
-- 한 가지만 했는데 나누라고 하니 사용자가 빠져나갈 길이 없다.
--
-- 원인: 예산 변경은 고영향으로 분류되고, 그때 progress 항목의 금액 외 필드가
-- 하나라도 달라지면 "혼합 변경"으로 거절한다. 그런데 그 카테고리에 항목이 아직
-- 없으면 **항목을 만드는 것 자체**가 금액 외 변경으로 잡힌다. 예산 화면과 모바일
-- 둘 다 아직 없는 카테고리에 금액을 넣을 때 항목을 함께 만들어 보낸다.
--
--   웹  (BudgetContent.handleBudgetChange) : {category, status, budget}
--   모바일 (buildCategoryBudgetMutation)    : {category, budget, payer}
--
-- 2026-08-24 운영 실측:
--   저니 54개 중 33개가 고정 카테고리 항목이 하나도 없는 상태 — 그 커플들은
--   화면에서 첫 금액을 넣을 수 없었다. 웹·모바일 본문 그대로 400 을 재현했고,
--   이미 항목이 있는 카테고리(대조군)는 200 이었다.
--   아모라 경로는 정상이었다(update_category_budget 은 이 함수를 안 지난다).
--
-- 고치는 방법: **새로 생기는 키에 한해** 최소 뼈대만 예외로 둔다.
-- 뼈대는 category(키와 같아야 함) · status(정해진 값) · label(문자열)뿐이고,
-- 그 밖의 필드가 하나라도 있으면 예전처럼 거절한다. 이미 있는 항목의 필드가
-- 바뀌는 경우도 예전 그대로 거절한다. 요약문은 그대로다 — 뒤따르는 요약 루프가
-- label/category 로 항목 이름을 이미 뽑고 있어서, 새 항목도 이름과 금액으로
-- 정확히 서술된다.
--
-- 규칙이 사는 함수는 둘이다(지출 델타 유무로 갈린다). 둘 다 같은 조건으로 고친다.
-- 두 본문 모두 운영에서 pg_get_functiondef 로 뽑은 정의에 그 한 줄만 치환한
-- 것이고, 나머지는 한 줄도 바뀌지 않았다.

CREATE OR REPLACE FUNCTION public.couple_plan_change_exact_high_summary_before_manual_schedule(p_old_wedding_date date, p_new_wedding_date date, p_old_venue text, p_new_venue text, p_old_total_budget bigint, p_new_total_budget bigint, p_old_progress jsonb, p_new_progress jsonb, p_bride_id uuid, p_groom_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_summary text := '';
  v_segment text;
  v_key text;
  v_field text;
  v_field_label text;
  v_category_label text;
  v_old_value text;
  v_new_value text;
  v_old_events jsonb;
  v_new_events jsonb;
  v_added_event jsonb;
  v_old_event_count integer;
  v_new_event_count integer;
  v_old_residual jsonb;
  v_new_residual jsonb;
BEGIN
  IF p_old_wedding_date IS DISTINCT FROM p_new_wedding_date THEN
    v_summary := format(
      '예식일: %s → %s',
      COALESCE(to_char(p_old_wedding_date, 'YYYY-MM-DD'), '미정'),
      COALESCE(to_char(p_new_wedding_date, 'YYYY-MM-DD'), '미정')
    );
  END IF;

  IF p_old_venue IS DISTINCT FROM p_new_venue THEN
    v_segment := format(
      '예식장: %s → %s',
      COALESCE(p_old_venue, '미정'),
      COALESCE(p_new_venue, '미정')
    );
    v_summary := CASE
      WHEN v_summary = '' THEN v_segment
      ELSE v_summary || ' · ' || v_segment
    END;
  END IF;

  IF p_old_total_budget IS DISTINCT FROM p_new_total_budget THEN
    v_segment := format(
      '총예산: %s → %s',
      CASE
        WHEN p_old_total_budget IS NULL THEN '미정'
        ELSE p_old_total_budget::text || '원'
      END,
      CASE
        WHEN p_new_total_budget IS NULL THEN '미정'
        ELSE p_new_total_budget::text || '원'
      END
    );
    v_summary := CASE
      WHEN v_summary = '' THEN v_segment
      ELSE v_summary || ' · ' || v_segment
    END;
  END IF;

  v_old_events := COALESCE(
    COALESCE(p_old_progress, '{}'::jsonb) -> '__events',
    '[]'::jsonb
  );
  v_new_events := COALESCE(
    COALESCE(p_new_progress, '{}'::jsonb) -> '__events',
    '[]'::jsonb
  );
  IF v_old_events IS DISTINCT FROM v_new_events THEN
    IF jsonb_typeof(v_old_events) IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_new_events) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_EVENT_DELTA'
        USING ERRCODE = '22023';
    END IF;

    v_old_event_count := jsonb_array_length(v_old_events);
    v_new_event_count := jsonb_array_length(v_new_events);
    IF v_new_event_count <> v_old_event_count + 1
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(v_old_events)
           WITH ORDINALITY AS old_event(value, position)
         WHERE v_new_events -> ((old_event.position - 1)::integer)
           IS DISTINCT FROM old_event.value
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_EVENT_DELTA'
        USING ERRCODE = '22023';
    END IF;

    v_added_event := v_new_events -> v_old_event_count;
    IF jsonb_typeof(v_added_event) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_added_event -> 'title') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_added_event -> 'date') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_EVENT_DELTA'
        USING ERRCODE = '22023';
    END IF;

    IF p_bride_id IS NOT NULL
       AND p_groom_id IS NOT NULL
       AND p_bride_id <> p_groom_id THEN
      IF v_added_event - ARRAY[
           'id',
           'date',
           'title',
           'memo',
           'categoryKey',
           'sourceKey',
           'momentType',
           'createdAt',
           'updatedAt'
         ]::text[] <> '{}'::jsonb
         OR (
           v_added_event ? 'memo'
           AND (
             jsonb_typeof(v_added_event -> 'memo')
               IS DISTINCT FROM 'string'
             OR v_added_event ->> 'memo' <> ''
           )
         ) THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
          USING ERRCODE = '22023';
      END IF;

      IF jsonb_typeof(v_added_event -> 'id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_added_event -> 'createdAt')
           IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_added_event -> 'updatedAt')
           IS DISTINCT FROM 'string'
         OR char_length(v_added_event ->> 'id') NOT BETWEEN 1 AND 200
         OR btrim(v_added_event ->> 'id') = ''
         OR char_length(v_added_event ->> 'createdAt') NOT BETWEEN 1 AND 100
         OR char_length(v_added_event ->> 'updatedAt') NOT BETWEEN 1 AND 100
         OR public.couple_plan_change_has_unsafe_display_text(
           v_added_event ->> 'id'
         )
         OR public.couple_plan_change_has_unsafe_display_text(
           v_added_event ->> 'createdAt'
         )
         OR public.couple_plan_change_has_unsafe_display_text(
           v_added_event ->> 'updatedAt'
         )
         OR v_added_event ->> 'createdAt' !~
           '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
         OR v_added_event ->> 'updatedAt' !~
           '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
         OR (
           v_added_event ? 'categoryKey'
           AND (
             jsonb_typeof(v_added_event -> 'categoryKey')
               IS DISTINCT FROM 'string'
             OR char_length(v_added_event ->> 'categoryKey') > 100
             OR public.couple_plan_change_has_unsafe_display_text(
               v_added_event ->> 'categoryKey'
             )
           )
         )
         OR (
           v_added_event ? 'sourceKey'
           AND (
             jsonb_typeof(v_added_event -> 'sourceKey')
               IS DISTINCT FROM 'string'
             OR char_length(v_added_event ->> 'sourceKey') > 200
             OR public.couple_plan_change_has_unsafe_display_text(
               v_added_event ->> 'sourceKey'
             )
           )
         )
         OR (
           v_added_event ? 'momentType'
           AND (
             jsonb_typeof(v_added_event -> 'momentType')
               IS DISTINCT FROM 'string'
             OR char_length(v_added_event ->> 'momentType') > 100
             OR public.couple_plan_change_has_unsafe_display_text(
               v_added_event ->> 'momentType'
             )
           )
         ) THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_EVENT_DELTA'
          USING ERRCODE = '22023';
      END IF;

      BEGIN
        IF to_char(
             to_date(
               left(v_added_event ->> 'createdAt', 10),
               'YYYY-MM-DD'
             ),
             'YYYY-MM-DD'
           ) IS DISTINCT FROM left(v_added_event ->> 'createdAt', 10)
           OR to_char(
             to_date(
               left(v_added_event ->> 'updatedAt', 10),
               'YYYY-MM-DD'
             ),
             'YYYY-MM-DD'
           ) IS DISTINCT FROM left(v_added_event ->> 'updatedAt', 10) THEN
          RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_EVENT_DELTA'
            USING ERRCODE = '22023';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_EVENT_DELTA'
          USING ERRCODE = '22023';
      END;
    END IF;

    v_old_value := btrim(v_added_event ->> 'title');
    v_new_value := v_added_event ->> 'date';
    IF char_length(v_old_value) NOT BETWEEN 1 AND 80
       OR public.couple_plan_change_has_unsafe_display_text(v_old_value)
       OR v_new_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR to_char(to_date(v_new_value, 'YYYY-MM-DD'), 'YYYY-MM-DD')
         IS DISTINCT FROM v_new_value
       OR public.couple_plan_change_has_unsafe_display_text(v_new_value) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_EVENT_DELTA'
        USING ERRCODE = '22023';
    END IF;

    v_segment := format(
      '일정 추가: %s (%s)',
      v_old_value,
      v_new_value
    );
    v_summary := CASE
      WHEN v_summary = '' THEN v_segment
      ELSE v_summary || ' · ' || v_segment
    END;
  END IF;

  -- A linked high-impact request must disclose every changed value that the
  -- partner is being asked to approve. The exact summary below owns the four
  -- protected fields and may read unchanged display-only labels; the event
  -- branch above owns one strictly bounded append. Any other progress
  -- mutation is routine state that cannot be silently bundled into the same
  -- 2/2 approval receipt.
  IF p_bride_id IS NOT NULL
     AND p_groom_id IS NOT NULL
     AND p_bride_id <> p_groom_id THEN
    IF jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb))
         IS DISTINCT FROM 'object'
       OR jsonb_typeof(COALESCE(p_new_progress, '{}'::jsonb))
         IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
        USING ERRCODE = '22023';
    END IF;

    FOR v_key IN
      SELECT old_keys.key
      FROM jsonb_object_keys(
        COALESCE(p_old_progress, '{}'::jsonb)
      ) AS old_keys(key)
      WHERE old_keys.key <> '__events'
      UNION
      SELECT new_keys.key
      FROM jsonb_object_keys(
        COALESCE(p_new_progress, '{}'::jsonb)
      ) AS new_keys(key)
      WHERE new_keys.key <> '__events'
      ORDER BY 1
    LOOP
      v_old_residual := p_old_progress -> v_key;
      v_new_residual := p_new_progress -> v_key;

      IF jsonb_typeof(v_old_residual) = 'object' THEN
        v_old_residual := v_old_residual - ARRAY[
          'budget',
          'payer',
          'responsibility',
          'assigned_to'
        ]::text[];
        IF v_old_residual = '{}'::jsonb THEN
          v_old_residual := NULL;
        END IF;
      END IF;
      IF jsonb_typeof(v_new_residual) = 'object' THEN
        v_new_residual := v_new_residual - ARRAY[
          'budget',
          'payer',
          'responsibility',
          'assigned_to'
        ]::text[];
        IF v_new_residual = '{}'::jsonb THEN
          v_new_residual := NULL;
        END IF;
      END IF;

      -- 새 항목을 만들면서 그 항목의 금액을 넣는 것은 "두 가지 변경"이 아니다.
      --
      -- 예산 화면과 모바일 둘 다, 아직 없는 카테고리에 금액을 넣으면 항목을 함께
      -- 만들어 보낸다. 그 뼈대를 다른 변경으로 세면 **첫 예산 입력이 통째로
      -- 거절된다.** 사용자에게는 "나누어 저장해 주세요"라는 말만 보이는데,
      -- 한 가지만 했으므로 나눌 것이 없어 빠져나갈 길이 없다.
      -- (2026-08-24 운영 실측: 저니 54개 중 33개가 고정 카테고리 항목이 하나도
      --  없는 상태였다. 그 커플들은 화면에서 첫 금액을 넣을 수 없었다.)
      --
      -- 그래서 **새로 생기는 키에 한해** 최소 뼈대만 예외로 둔다.
      -- 뼈대는 category(키와 같아야 함) · status(정해진 값) · label(문자열)뿐이고,
      -- 그 밖의 필드가 하나라도 있으면 예전처럼 거절한다. 이미 있는 항목의
      -- 필드가 바뀌는 경우도 예전 그대로 거절한다.
      IF v_old_residual IS DISTINCT FROM v_new_residual
         AND NOT (
           v_old_residual IS NULL
           AND jsonb_typeof(v_new_residual) = 'object'
           AND v_new_residual - ARRAY['category', 'status', 'label']::text[]
               = '{}'::jsonb
           AND v_new_residual ->> 'category' = v_key
           AND (
             NOT (v_new_residual ? 'status')
             OR v_new_residual ->> 'status' IN (
               'not_started', 'in_progress', 'completed'
             )
           )
           AND (
             NOT (v_new_residual ? 'label')
             OR jsonb_typeof(v_new_residual -> 'label') = 'string'
           )
         ) THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb)) = 'object'
     AND jsonb_typeof(COALESCE(p_new_progress, '{}'::jsonb)) = 'object' THEN
    FOR v_key IN
      SELECT old_keys.key
      FROM jsonb_object_keys(
        COALESCE(p_old_progress, '{}'::jsonb)
      ) AS old_keys(key)
      UNION
      SELECT new_keys.key
      FROM jsonb_object_keys(
        COALESCE(p_new_progress, '{}'::jsonb)
      ) AS new_keys(key)
      ORDER BY 1
    LOOP
      v_category_label := COALESCE(
        NULLIF(p_new_progress -> v_key ->> 'label', ''),
        NULLIF(p_old_progress -> v_key ->> 'label', ''),
        NULLIF(p_new_progress -> v_key ->> 'name', ''),
        NULLIF(p_old_progress -> v_key ->> 'name', ''),
        NULLIF(p_new_progress -> v_key ->> 'category', ''),
        NULLIF(p_old_progress -> v_key ->> 'category', ''),
        v_key
      );
      IF char_length(v_category_label) > 40
         OR public.couple_plan_change_has_unsafe_display_text(
           v_category_label
         ) THEN
        v_category_label := v_key;
      END IF;

      FOREACH v_field IN ARRAY ARRAY[
        'budget', 'payer', 'responsibility', 'assigned_to'
      ]
      LOOP
        IF (p_old_progress -> v_key -> v_field) IS NOT DISTINCT FROM
             (p_new_progress -> v_key -> v_field) THEN
          CONTINUE;
        END IF;

        v_field_label := CASE v_field
          WHEN 'budget' THEN '예산'
          WHEN 'payer' THEN '부담'
          WHEN 'responsibility' THEN '책임'
          ELSE '담당'
        END;
        v_old_value := CASE
          WHEN p_old_progress -> v_key -> v_field IS NULL
            OR p_old_progress -> v_key -> v_field = 'null'::jsonb
            THEN '미정'
          WHEN v_field = 'budget'
            AND jsonb_typeof(
              p_old_progress -> v_key -> v_field
            ) = 'number'
            THEN (p_old_progress -> v_key ->> v_field) || '원'
          ELSE COALESCE(
            p_old_progress -> v_key ->> v_field,
            (p_old_progress -> v_key -> v_field)::text
          )
        END;
        v_new_value := CASE
          WHEN p_new_progress -> v_key -> v_field IS NULL
            OR p_new_progress -> v_key -> v_field = 'null'::jsonb
            THEN '미정'
          WHEN v_field = 'budget'
            AND jsonb_typeof(
              p_new_progress -> v_key -> v_field
            ) = 'number'
            THEN (p_new_progress -> v_key ->> v_field) || '원'
          ELSE COALESCE(
            p_new_progress -> v_key ->> v_field,
            (p_new_progress -> v_key -> v_field)::text
          )
        END;

        IF v_field = 'payer' THEN
          v_old_value := CASE v_old_value
            WHEN 'couple' THEN '두 사람'
            WHEN 'bride_parents' THEN '예비 신부 가족'
            WHEN 'groom_parents' THEN '예비 신랑 가족'
            WHEN 'both_parents' THEN '두 가족'
            WHEN 'bride' THEN '예비 신부'
            WHEN 'groom' THEN '예비 신랑'
            ELSE v_old_value
          END;
          v_new_value := CASE v_new_value
            WHEN 'couple' THEN '두 사람'
            WHEN 'bride_parents' THEN '예비 신부 가족'
            WHEN 'groom_parents' THEN '예비 신랑 가족'
            WHEN 'both_parents' THEN '두 가족'
            WHEN 'bride' THEN '예비 신부'
            WHEN 'groom' THEN '예비 신랑'
            ELSE v_new_value
          END;
        ELSIF v_field IN ('responsibility', 'assigned_to') THEN
          v_old_value := CASE
            WHEN v_old_value = 'bride'
              OR v_old_value = COALESCE(p_bride_id::text, '')
              THEN '예비 신부'
            WHEN v_old_value = 'groom'
              OR v_old_value = COALESCE(p_groom_id::text, '')
              THEN '예비 신랑'
            WHEN v_old_value = 'couple' THEN '두 사람'
            WHEN v_old_value ~
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN '담당자 지정됨'
            ELSE v_old_value
          END;
          v_new_value := CASE
            WHEN v_new_value = 'bride'
              OR v_new_value = COALESCE(p_bride_id::text, '')
              THEN '예비 신부'
            WHEN v_new_value = 'groom'
              OR v_new_value = COALESCE(p_groom_id::text, '')
              THEN '예비 신랑'
            WHEN v_new_value = 'couple' THEN '두 사람'
            WHEN v_new_value ~
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN '담당자 지정됨'
            ELSE v_new_value
          END;
        END IF;

        v_segment := format(
          '%s %s: %s → %s',
          v_category_label,
          v_field_label,
          v_old_value,
          v_new_value
        );
        v_summary := CASE
          WHEN v_summary = '' THEN v_segment
          ELSE v_summary || ' · ' || v_segment
        END;
      END LOOP;
    END LOOP;
  END IF;

  IF v_summary = ''
     OR char_length(v_summary) > 240
     OR public.couple_plan_change_has_unsafe_display_text(v_summary) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_SUMMARY_TOO_LONG'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_summary;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.couple_plan_change_exact_high_summary(p_old_wedding_date date, p_new_wedding_date date, p_old_venue text, p_new_venue text, p_old_total_budget bigint, p_new_total_budget bigint, p_old_progress jsonb, p_new_progress jsonb, p_bride_id uuid, p_groom_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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
    -- 새 항목을 만들면서 그 항목의 금액을 넣는 것은 "두 가지 변경"이 아니다.
    --
    -- 예산 화면과 모바일 둘 다, 아직 없는 카테고리에 금액을 넣으면 항목을 함께
    -- 만들어 보낸다. 그 뼈대를 다른 변경으로 세면 **첫 예산 입력이 통째로
    -- 거절된다.** 사용자에게는 "나누어 저장해 주세요"라는 말만 보이는데,
    -- 한 가지만 했으므로 나눌 것이 없어 빠져나갈 길이 없다.
    -- (2026-08-24 운영 실측: 저니 54개 중 33개가 고정 카테고리 항목이 하나도
    --  없는 상태였다. 그 커플들은 화면에서 첫 금액을 넣을 수 없었다.)
    --
    -- 그래서 **새로 생기는 키에 한해** 최소 뼈대만 예외로 둔다.
    -- 뼈대는 category(키와 같아야 함) · status(정해진 값) · label(문자열)뿐이고,
    -- 그 밖의 필드가 하나라도 있으면 예전처럼 거절한다. 이미 있는 항목의
    -- 필드가 바뀌는 경우도 예전 그대로 거절한다.
    IF v_old_residual IS DISTINCT FROM v_new_residual
       AND NOT (
         v_old_residual IS NULL
         AND jsonb_typeof(v_new_residual) = 'object'
         AND v_new_residual - ARRAY['category', 'status', 'label']::text[]
             = '{}'::jsonb
         AND v_new_residual ->> 'category' = v_key
         AND (
           NOT (v_new_residual ? 'status')
           OR v_new_residual ->> 'status' IN (
             'not_started', 'in_progress', 'completed'
           )
         )
         AND (
           NOT (v_new_residual ? 'label')
           OR jsonb_typeof(v_new_residual -> 'label') = 'string'
         )
       ) THEN
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
$function$
;
