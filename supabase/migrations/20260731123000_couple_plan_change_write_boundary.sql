BEGIN;

-- Manual shared-plan writes use the same journey revision clock as Amora, but
-- have their own durable request/acceptance ledger. The separate write trigger
-- below closes direct authenticated and service-role high-impact UPDATE paths
-- without weakening the already-validated Amora atomic guard.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.couple_plan_change_has_unsafe_display_text(
  p_value text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT p_value ~ '[[:cntrl:]]'
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        173,   -- U+00AD soft hyphen
        1564,  -- U+061C Arabic letter mark
        6158,  -- U+180E Mongolian vowel separator
        8203, 8204, 8205, 8206, 8207, -- U+200B..U+200F
        8232, 8233, 8234, 8235, 8236, 8237, 8238, -- U+2028..U+202E
        8288, 8289, 8290, 8291, 8292, -- U+2060..U+2064
        8294, 8295, 8296, 8297, 8298, 8299, 8300, 8301, 8302, 8303,
        65279  -- U+FEFF zero-width no-break space / BOM
      ]::integer[]) AS forbidden(codepoint)
      WHERE strpos(p_value, chr(forbidden.codepoint)) > 0
    );
$function$;

ALTER FUNCTION public.couple_plan_change_has_unsafe_display_text(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.couple_plan_change_has_unsafe_display_text(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.couple_plan_change_has_unsafe_display_text(text)
  TO service_role;

CREATE TABLE public.couple_plan_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_revision bigint NOT NULL CHECK (
    base_revision BETWEEN 0 AND 9007199254740990
  ),
  changes jsonb NOT NULL CHECK (
    jsonb_typeof(changes) = 'object'
    AND changes <> '{}'::jsonb
    AND octet_length(changes::text) <= 131072
  ),
  change_digest text NOT NULL CHECK (change_digest ~ '^[a-f0-9]{64}$'),
  roster_fingerprint text NOT NULL CHECK (
    roster_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  surface_href text NOT NULL CHECK (
    surface_href IN ('/schedule', '/budget', '/dashboard')
  ),
  summary text NOT NULL CHECK (
    char_length(summary) BETWEEN 1 AND 240
    AND summary = btrim(summary)
    AND NOT public.couple_plan_change_has_unsafe_display_text(summary)
  ),
  is_high_impact boolean NOT NULL,
  required_count smallint NOT NULL CHECK (required_count IN (1, 2)),
  status text NOT NULL CHECK (
    status IN ('pending', 'applying', 'applied', 'stale', 'rejected')
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  actor_accepted_at timestamptz NOT NULL,
  applying_at timestamptz,
  applied_at timestamptz,
  applied_by_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  applied_revision bigint CHECK (
    applied_revision IS NULL OR applied_revision = base_revision + 1
  ),
  rejected_at timestamptz,
  rejected_by_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  stale_at timestamptz,
  stale_reason text CHECK (
    stale_reason IS NULL
    OR stale_reason IN (
      'expired',
      'revision_changed',
      'roster_changed',
      'journey_missing'
    )
  ),
  CHECK (expires_at > created_at),
  CHECK (actor_accepted_at >= created_at),
  CHECK (
    (status = 'applying') = (applying_at IS NOT NULL)
    OR status = 'applied'
  ),
  CHECK (
    (status = 'applied') = (
      applied_at IS NOT NULL
      AND applied_by_user_id IS NOT NULL
      AND applied_revision IS NOT NULL
    )
  ),
  CHECK (
    (status = 'rejected') = (
      rejected_at IS NOT NULL AND rejected_by_user_id IS NOT NULL
    )
  ),
  CHECK (
    (status = 'stale') = (stale_at IS NOT NULL AND stale_reason IS NOT NULL)
  )
);

CREATE TABLE public.couple_plan_change_acceptances (
  request_id uuid NOT NULL
    REFERENCES public.couple_plan_change_requests(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_digest text NOT NULL CHECK (change_digest ~ '^[a-f0-9]{64}$'),
  roster_fingerprint text NOT NULL CHECK (
    roster_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (request_id, user_id)
);

CREATE UNIQUE INDEX couple_plan_change_submit_idempotency_idx
  ON public.couple_plan_change_requests (
    couple_id,
    actor_user_id,
    base_revision,
    change_digest,
    roster_fingerprint
  )
  WHERE status <> 'stale';

CREATE UNIQUE INDEX couple_plan_change_one_active_high_impact_idx
  ON public.couple_plan_change_requests (couple_id)
  WHERE status = 'pending' AND is_high_impact;

CREATE INDEX couple_plan_change_requests_couple_status_idx
  ON public.couple_plan_change_requests (
    couple_id, status, created_at DESC, id DESC
  );

CREATE INDEX couple_plan_change_acceptances_request_idx
  ON public.couple_plan_change_acceptances (
    request_id, change_digest, roster_fingerprint, accepted_at
  );

ALTER TABLE public.couple_plan_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_plan_change_acceptances ENABLE ROW LEVEL SECURITY;

-- Journey creation is a server-owned neutral bootstrap. Authenticated members
-- must never create a pre-populated row to bypass the same durable 1/1 or 2/2
-- plan-change contract enforced for UPDATE.
DROP POLICY IF EXISTS journeys_insert_couple ON public.wedding_journeys;
DROP POLICY IF EXISTS "journeys_insert_couple" ON public.wedding_journeys;
DROP POLICY IF EXISTS journeys_update_couple ON public.wedding_journeys;
DROP POLICY IF EXISTS "journeys_update_couple" ON public.wedding_journeys;
REVOKE INSERT ON TABLE public.wedding_journeys
  FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON TABLE public.wedding_journeys
  FROM PUBLIC, anon, authenticated;

CREATE POLICY couple_plan_change_requests_service_all
  ON public.couple_plan_change_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY couple_plan_change_acceptances_service_all
  ON public.couple_plan_change_acceptances
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.couple_plan_change_requests
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.couple_plan_change_acceptances
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.couple_plan_change_requests TO service_role;
GRANT ALL ON TABLE public.couple_plan_change_acceptances TO service_role;

-- Manual terminal lifecycle events are deliberately neutral. They replace an
-- approval card for the decision-maker and give the other member a terminal
-- row with the same action_id, so newest-action dedupe cannot resurrect an
-- already decided request.
ALTER TABLE public.couple_change_notifications
  DROP CONSTRAINT IF EXISTS couple_change_notifications_event_kind_check;
ALTER TABLE public.couple_change_notifications
  ADD CONSTRAINT couple_change_notifications_event_kind_check CHECK (
    event_kind IN (
      'approval_requested',
      'approval_pending',
      'approval_ready',
      'approval_withdrawn',
      'change_applied',
      'change_rejected',
      'change_stale'
    )
  );
ALTER TABLE public.couple_change_notifications
  DROP CONSTRAINT IF EXISTS couple_change_notifications_check;
ALTER TABLE public.couple_change_notifications
  ADD CONSTRAINT couple_change_notifications_actor_recipient_check CHECK (
    actor_user_id <> recipient_user_id
    OR event_kind IN (
      'approval_pending',
      'change_applied',
      'change_rejected',
      'change_stale'
    )
  );

CREATE OR REPLACE FUNCTION public.normalize_couple_plan_changes(
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_text text;
  v_date date;
  v_budget bigint;
  v_remove_keys jsonb;
  v_item_count integer;
BEGIN
  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
     OR p_changes = '{}'::jsonb
     OR p_changes - ARRAY[
       'wedding_date',
       'venue',
       'total_budget',
       'progress_patch',
       'progress_remove_keys'
     ] <> '{}'::jsonb
     OR octet_length(p_changes::text) > 131072 THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  IF p_changes ? 'wedding_date' THEN
    IF jsonb_typeof(p_changes -> 'wedding_date') = 'null' THEN
      v_result := v_result || jsonb_build_object('wedding_date', NULL);
    ELSIF jsonb_typeof(p_changes -> 'wedding_date') = 'string' THEN
      v_text := p_changes ->> 'wedding_date';
      IF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_date := v_text::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END;
      IF to_char(v_date, 'YYYY-MM-DD') IS DISTINCT FROM v_text THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_result := v_result || jsonb_build_object('wedding_date', v_text);
    ELSE
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_changes ? 'venue' THEN
    IF jsonb_typeof(p_changes -> 'venue') = 'null' THEN
      v_result := v_result || jsonb_build_object('venue', NULL);
    ELSIF jsonb_typeof(p_changes -> 'venue') = 'string' THEN
      v_text := p_changes ->> 'venue';
      IF char_length(v_text) NOT BETWEEN 1 AND 120
         OR v_text IS DISTINCT FROM btrim(v_text)
         OR public.couple_plan_change_has_unsafe_display_text(v_text) THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_result := v_result || jsonb_build_object('venue', v_text);
    ELSE
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_changes ? 'total_budget' THEN
    IF jsonb_typeof(p_changes -> 'total_budget') = 'null' THEN
      v_result := v_result || jsonb_build_object('total_budget', NULL);
    ELSIF jsonb_typeof(p_changes -> 'total_budget') = 'number' THEN
      v_text := p_changes ->> 'total_budget';
      IF v_text !~ '^(0|[1-9][0-9]{0,9})$' THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_budget := v_text::bigint;
      IF v_budget > 1000000000 THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_result := v_result || jsonb_build_object('total_budget', v_budget);
    ELSE
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_changes ? 'progress_patch' THEN
    IF jsonb_typeof(p_changes -> 'progress_patch') IS DISTINCT FROM 'object'
       OR octet_length((p_changes -> 'progress_patch')::text) > 131072 THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::integer
      INTO v_item_count
    FROM jsonb_object_keys(p_changes -> 'progress_patch');
    IF v_item_count > 300
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(p_changes -> 'progress_patch') AS item(key)
         WHERE item.key !~ '^[a-zA-Z0-9_.:-]{1,80}$'
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    v_result := v_result
      || jsonb_build_object('progress_patch', p_changes -> 'progress_patch');
  END IF;

  IF p_changes ? 'progress_remove_keys' THEN
    IF jsonb_typeof(p_changes -> 'progress_remove_keys')
         IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_changes -> 'progress_remove_keys') > 50
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           p_changes -> 'progress_remove_keys'
         ) AS item(value)
         WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
             jsonb_agg(to_jsonb(keys.key) ORDER BY keys.key),
             '[]'::jsonb
           )
      INTO v_remove_keys
    FROM (
      SELECT item.value #>> '{}' AS key
      FROM jsonb_array_elements(
        p_changes -> 'progress_remove_keys'
      ) AS item(value)
      GROUP BY item.value #>> '{}'
    ) AS keys;

    IF jsonb_array_length(v_remove_keys)
         IS DISTINCT FROM jsonb_array_length(
           p_changes -> 'progress_remove_keys'
         )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(v_remove_keys) AS item(key)
         WHERE item.key !~ '^[a-zA-Z0-9_.:-]{1,80}$'
       )
       OR (
         p_changes ? 'progress_patch'
         AND EXISTS (
           SELECT 1
           FROM jsonb_object_keys(
             p_changes -> 'progress_patch'
           ) AS patched(key)
           WHERE v_remove_keys ? patched.key
         )
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    v_result := v_result
      || jsonb_build_object('progress_remove_keys', v_remove_keys);
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.couple_plan_change_digest(
  p_changes jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'version', 1,
          'changes', p_changes
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
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
  v_field text;
BEGIN
  IF p_old_wedding_date IS DISTINCT FROM p_new_wedding_date
     OR p_old_venue IS DISTINCT FROM p_new_venue
     OR p_old_total_budget IS DISTINCT FROM p_new_total_budget THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object'
     OR jsonb_typeof(COALESCE(p_new_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object' THEN
    RETURN p_old_progress IS DISTINCT FROM p_new_progress;
  END IF;

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
  LOOP
    IF (p_old_progress -> v_key) IS NOT DISTINCT FROM
         (p_new_progress -> v_key) THEN
      CONTINUE;
    END IF;

    FOREACH v_field IN ARRAY ARRAY[
      'budget', 'payer', 'responsibility', 'assigned_to'
    ]
    LOOP
      IF (p_old_progress -> v_key -> v_field) IS DISTINCT FROM
           (p_new_progress -> v_key -> v_field) THEN
        RETURN true;
      END IF;
    END LOOP;
  END LOOP;

  RETURN false;
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

      IF v_old_residual IS DISTINCT FROM v_new_residual THEN
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
$function$;

ALTER FUNCTION public.normalize_couple_plan_changes(jsonb) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_digest(jsonb) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.normalize_couple_plan_changes(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

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

  -- Do not duplicate the existing Amora authority checks. A complete marker
  -- set is routed onward; trg_advance_wedding_journey_state_revision validates
  -- it against the immutable proposal, execution, acceptance, and receipt.
  IF v_amora_couple IS NOT NULL
     AND v_amora_request IS NOT NULL
     AND v_amora_operation IS NOT NULL
     AND v_amora_action IS NOT NULL
     AND v_amora_revision IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Reject ordinary direct writes before touching the couple row. UPDATE has
  -- already locked the journey row, while plan RPCs deliberately lock
  -- couple -> journey. Taking the couple lock for an unmarked member write
  -- would invert that order and let repeated rejected writes deadlock valid
  -- partner decisions. Solo high-impact writes use the same 1/1 plan RPC.
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

  -- A row lock here serializes partner link/unlink with the linked-boundary
  -- decision. Plan RPCs take this couple lock before the journey lock.
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

  -- Solo journeys remain writable through their one-person plan RPC. The
  -- global 2/2 fence only exists while two distinct current members are valid.
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

CREATE OR REPLACE FUNCTION public.couple_plan_change_result(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_accepted_count integer;
  v_journey jsonb := NULL;
  v_result_status text;
BEGIN
  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT LEAST(
           v_request.required_count::integer,
           count(*)::integer
         )
    INTO v_accepted_count
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = v_request.id
    AND acceptance.couple_id = v_request.couple_id
    AND acceptance.change_digest = v_request.change_digest
    AND acceptance.roster_fingerprint = v_request.roster_fingerprint;

  IF v_request.status = 'applied' THEN
    SELECT to_jsonb(journey)
      INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = v_request.couple_id;
  END IF;

  v_result_status := CASE v_request.status
    WHEN 'pending' THEN 'pending_partner'
    WHEN 'applying' THEN 'pending_partner'
    ELSE v_request.status
  END;

  RETURN jsonb_build_object(
    'requestId', v_request.id,
    'status', v_result_status,
    'requiredCount', v_request.required_count,
    'acceptedCount', v_accepted_count,
    'isHighImpact', v_request.is_high_impact,
    'baseRevision', v_request.base_revision,
    'appliedRevision', v_request.applied_revision,
    'surface', v_request.surface_href,
    'summary', v_request.summary,
    'expiresAt', v_request.expires_at,
    'journey', v_journey
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_couple_plan_change_notifications_locked(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_terminal_event text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_recipient_user_id uuid;
  v_title text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR p_terminal_event NOT IN (
       'change_applied', 'change_rejected', 'change_stale'
     ) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_request.couple_id;
  v_bride_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_bride_id, v_request.couple_id
    ) THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_groom_id, v_request.couple_id
    ) THEN v_raw_groom_id
    ELSE NULL
  END;

  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_title := CASE p_terminal_event
    WHEN 'change_applied' THEN '함께 쓰는 계획이 변경됐어요'
    WHEN 'change_rejected' THEN '계획 변경 요청을 반영하지 않았어요'
    ELSE '계획 변경 요청을 다시 확인해 주세요'
  END;

  -- Convert both sides of the pending decision into terminal rows. Only the
  -- recipient who actually made the decision has read the terminal state.
  -- Everyone else must receive it as unread even if they had already opened
  -- the earlier pending card.
  UPDATE public.couple_change_notifications AS notification
  SET event_kind = p_terminal_event,
      actor_user_id = p_actor_user_id,
      title = v_title,
      message = v_request.summary,
      href = v_request.surface_href,
      read_at = CASE
        WHEN notification.recipient_user_id = p_actor_user_id
          THEN COALESCE(notification.read_at, clock_timestamp())
        ELSE NULL
      END,
      created_at = clock_timestamp()
  WHERE notification.couple_id = v_request.couple_id
    AND notification.action_id = v_request.id
    AND notification.event_kind IN (
      'approval_requested', 'approval_pending'
    );

  -- A linked 2/2 request already has an atomic card for each member captured
  -- by its roster fingerprint. Never derive a new recipient from the current
  -- roster here: after a partner replacement that would disclose an old
  -- request to someone who never participated in it. Only an immediately
  -- applied 1/1 routine change needs a fresh notification for its currently
  -- locked partner.
  IF v_request.required_count = 1 THEN
    v_recipient_user_id := CASE
      WHEN p_actor_user_id = v_bride_id THEN v_groom_id
      WHEN p_actor_user_id = v_groom_id THEN v_bride_id
      ELSE NULL
    END;

    IF v_recipient_user_id IS NOT NULL
       AND v_recipient_user_id <> p_actor_user_id THEN
      INSERT INTO public.couple_change_notifications(
        couple_id,
        recipient_user_id,
        actor_user_id,
        source_message_id,
        action_id,
        event_kind,
        tool_name,
        title,
        message,
        href
      ) VALUES (
        v_request.couple_id,
        v_recipient_user_id,
        p_actor_user_id,
        v_request.id,
        v_request.id,
        p_terminal_event,
        'manual_plan_change',
        v_title,
        v_request.summary,
        v_request.surface_href
      )
      ON CONFLICT (
        couple_id, recipient_user_id, action_id, event_kind
      ) DO NOTHING;
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_couple_plan_change_locked(
  p_request_id uuid,
  p_apply_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_journey public.wedding_journeys%ROWTYPE;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_recipient_user_id uuid;
  v_roster_fingerprint text;
  v_accepted_count integer;
  v_remove_keys text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id;

  IF NOT FOUND OR v_request.status <> 'applying' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_request.couple_id;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_bride_id, v_request.couple_id
    ) THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_groom_id, v_request.couple_id
    ) THEN v_raw_groom_id
    ELSE NULL
  END;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  IF p_apply_user_id IS NULL
     OR (
       p_apply_user_id IS DISTINCT FROM v_bride_id
       AND p_apply_user_id IS DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF v_request.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_request.expires_at <= clock_timestamp()
     OR v_request.change_digest IS DISTINCT FROM
       public.couple_plan_change_digest(v_request.changes) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  SELECT count(*)::integer
    INTO v_accepted_count
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = v_request.id
    AND acceptance.couple_id = v_request.couple_id
    AND acceptance.change_digest = v_request.change_digest
    AND acceptance.roster_fingerprint = v_request.roster_fingerprint
    AND acceptance.user_id IN (v_bride_id, v_groom_id);

  IF v_accepted_count < v_request.required_count THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(
      v_request.changes -> 'progress_remove_keys',
      '[]'::jsonb
    )
  ) AS item(key);

  PERFORM set_config(
    'hanbang.couple_plan_change_request_id',
    v_request.id::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_couple_id',
    v_request.couple_id::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_base_revision',
    v_request.base_revision::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_digest',
    v_request.change_digest,
    true
  );

  BEGIN
    UPDATE public.wedding_journeys AS journey
    SET wedding_date = CASE
          WHEN v_request.changes ? 'wedding_date'
            THEN (v_request.changes ->> 'wedding_date')::date
          ELSE journey.wedding_date
        END,
        venue = CASE
          WHEN v_request.changes ? 'venue'
            THEN v_request.changes ->> 'venue'
          ELSE journey.venue
        END,
        total_budget = CASE
          WHEN v_request.changes ? 'total_budget'
            THEN (v_request.changes ->> 'total_budget')::bigint
          ELSE journey.total_budget
        END,
        progress = (
          COALESCE(journey.progress, '{}'::jsonb) - v_remove_keys
        ) || COALESCE(
          v_request.changes -> 'progress_patch',
          '{}'::jsonb
        )
    WHERE journey.couple_id = v_request.couple_id
      AND journey.state_revision = v_request.base_revision
    RETURNING journey.* INTO v_journey;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('hanbang.couple_plan_change_request_id', '', true);
    PERFORM set_config('hanbang.couple_plan_change_couple_id', '', true);
    PERFORM set_config('hanbang.couple_plan_change_base_revision', '', true);
    PERFORM set_config('hanbang.couple_plan_change_digest', '', true);
    RAISE;
  END;

  PERFORM set_config('hanbang.couple_plan_change_request_id', '', true);
  PERFORM set_config('hanbang.couple_plan_change_couple_id', '', true);
  PERFORM set_config('hanbang.couple_plan_change_base_revision', '', true);
  PERFORM set_config('hanbang.couple_plan_change_digest', '', true);

  IF v_journey.id IS NULL
     OR v_journey.couple_id IS DISTINCT FROM v_request.couple_id
     OR v_journey.state_revision IS DISTINCT FROM
       v_request.base_revision + 1 THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.couple_plan_change_requests AS request
  SET status = 'applied',
      applied_at = clock_timestamp(),
      applied_by_user_id = p_apply_user_id,
      applied_revision = v_journey.state_revision
  WHERE request.id = v_request.id
    AND request.status = 'applying';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  PERFORM public.finalize_couple_plan_change_notifications_locked(
    v_request.id,
    p_apply_user_id,
    'change_applied'
  );

  RETURN to_jsonb(v_journey);
END;
$function$;

ALTER FUNCTION public.couple_plan_change_result(uuid) OWNER TO postgres;
ALTER FUNCTION public.finalize_couple_plan_change_notifications_locked(
  uuid, uuid, text
) OWNER TO postgres;
ALTER FUNCTION public.apply_couple_plan_change_locked(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.couple_plan_change_result(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_couple_plan_change_notifications_locked(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_couple_plan_change_locked(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

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
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_partner_user_id uuid;
  v_roster_fingerprint text;
  v_required_count smallint;
  v_changes jsonb;
  v_change_digest text;
  v_remove_keys text[];
  v_next_date date;
  v_next_venue text;
  v_next_budget bigint;
  v_next_progress jsonb;
  v_is_high_impact boolean;
  v_summary text;
  v_journey public.wedding_journeys%ROWTYPE;
  v_existing public.couple_plan_change_requests%ROWTYPE;
  v_request_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_initial_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_revision NOT BETWEEN 0 AND 9007199254740990
     OR p_surface NOT IN ('/schedule', '/budget', '/dashboard')
     OR p_summary IS NULL
     OR char_length(p_summary) NOT BETWEEN 1 AND 240
     OR p_summary IS DISTINCT FROM btrim(p_summary)
     OR public.couple_plan_change_has_unsafe_display_text(p_summary) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  v_changes := public.normalize_couple_plan_changes(p_changes);
  v_change_digest := public.couple_plan_change_digest(v_changes);

  -- Global order for every public RPC: couple -> journey -> request.
  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;

  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_partner_user_id := CASE
    WHEN p_actor_user_id = v_bride_id THEN v_groom_id
    WHEN p_actor_user_id = v_groom_id THEN v_bride_id
    ELSE NULL
  END;
  IF v_partner_user_id = p_actor_user_id THEN
    v_partner_user_id := NULL;
  END IF;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT journey.*
    INTO v_journey
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  -- This lookup intentionally precedes no-op detection. A committed apply
  -- followed by a lost HTTP response makes the requested value equal current
  -- state; the durable receipt must win over a misleading INVALID response.
  -- An applied receipt always wins, even after the roster changes: this is the
  -- lost-response exact-once recovery path.
  SELECT request.*
    INTO v_existing
  FROM public.couple_plan_change_requests AS request
  WHERE request.couple_id = p_couple_id
    AND request.actor_user_id = p_actor_user_id
    AND request.base_revision = p_expected_revision
    AND request.change_digest = v_change_digest
    AND request.status = 'applied'
  ORDER BY request.applied_at DESC, request.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN public.couple_plan_change_result(v_existing.id);
  END IF;

  -- Active/rejected idempotency is roster-scoped. Stale receipts are excluded
  -- so an expired request or a changed roster can express a fresh intent.
  SELECT request.*
    INTO v_existing
  FROM public.couple_plan_change_requests AS request
  WHERE request.couple_id = p_couple_id
    AND request.actor_user_id = p_actor_user_id
    AND request.base_revision = p_expected_revision
    AND request.change_digest = v_change_digest
    AND request.roster_fingerprint = v_roster_fingerprint
    AND request.status <> 'stale'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'pending'
       AND (
         v_existing.expires_at <= v_now
         OR v_existing.roster_fingerprint IS DISTINCT FROM
           v_roster_fingerprint
         OR v_existing.base_revision IS DISTINCT FROM
           v_journey.state_revision
       ) THEN
      UPDATE public.couple_plan_change_requests AS request
      SET status = 'stale',
          stale_at = v_now,
          stale_reason = CASE
            WHEN v_existing.expires_at <= v_now THEN 'expired'
            WHEN v_existing.roster_fingerprint IS DISTINCT FROM
              v_roster_fingerprint THEN 'roster_changed'
            ELSE 'revision_changed'
          END
      WHERE request.id = v_existing.id
        AND request.status = 'pending';
      PERFORM public.finalize_couple_plan_change_notifications_locked(
        v_existing.id,
        p_actor_user_id,
        'change_stale'
      );
      -- A changed revision cannot be retried with the old CAS token. Expiry or
      -- roster change at the same revision may continue into a new request.
      IF v_existing.base_revision IS DISTINCT FROM
           v_journey.state_revision THEN
        RETURN public.couple_plan_change_result(v_existing.id);
      END IF;
    ELSE
      RETURN public.couple_plan_change_result(v_existing.id);
    END IF;
  END IF;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(v_changes -> 'progress_remove_keys', '[]'::jsonb)
  ) AS item(key);

  v_next_date := CASE
    WHEN v_changes ? 'wedding_date'
      THEN (v_changes ->> 'wedding_date')::date
    ELSE v_journey.wedding_date
  END;
  v_next_venue := CASE
    WHEN v_changes ? 'venue'
      THEN v_changes ->> 'venue'
    ELSE v_journey.venue
  END;
  v_next_budget := CASE
    WHEN v_changes ? 'total_budget'
      THEN (v_changes ->> 'total_budget')::bigint
    ELSE v_journey.total_budget
  END;
  v_next_progress := (
    COALESCE(v_journey.progress, '{}'::jsonb) - v_remove_keys
  ) || COALESCE(v_changes -> 'progress_patch', '{}'::jsonb);

  IF v_next_date IS NOT DISTINCT FROM v_journey.wedding_date
     AND v_next_venue IS NOT DISTINCT FROM v_journey.venue
     AND v_next_budget IS NOT DISTINCT FROM v_journey.total_budget
     AND v_next_progress IS NOT DISTINCT FROM v_journey.progress THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  v_is_high_impact := public.couple_plan_change_is_high_impact(
    v_journey.wedding_date,
    v_next_date,
    v_journey.venue,
    v_next_venue,
    v_journey.total_budget,
    v_next_budget,
    v_journey.progress,
    v_next_progress
  );
  v_summary := CASE
    WHEN v_is_high_impact THEN
      public.couple_plan_change_exact_high_summary(
        v_journey.wedding_date,
        v_next_date,
        v_journey.venue,
        v_next_venue,
        v_journey.total_budget,
        v_next_budget,
        v_journey.progress,
        v_next_progress,
        v_bride_id,
        v_groom_id
      )
    ELSE p_summary
  END;
  v_required_count := CASE
    WHEN v_is_high_impact
     AND v_bride_id IS NOT NULL
     AND v_groom_id IS NOT NULL
     AND v_bride_id <> v_groom_id THEN 2
    ELSE 1
  END;

  IF v_is_high_impact THEN
    SELECT request.*
      INTO v_existing
    FROM public.couple_plan_change_requests AS request
    WHERE request.couple_id = p_couple_id
      AND request.status = 'pending'
      AND request.is_high_impact
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.expires_at <= v_now
         OR v_existing.roster_fingerprint IS DISTINCT FROM
           v_roster_fingerprint
         OR v_existing.base_revision IS DISTINCT FROM
           v_journey.state_revision THEN
        UPDATE public.couple_plan_change_requests AS request
        SET status = 'stale',
            stale_at = v_now,
            stale_reason = CASE
              WHEN v_existing.expires_at <= v_now THEN 'expired'
              WHEN v_existing.roster_fingerprint IS DISTINCT FROM
                v_roster_fingerprint THEN 'roster_changed'
              ELSE 'revision_changed'
            END
        WHERE request.id = v_existing.id
          AND request.status = 'pending';
        PERFORM public.finalize_couple_plan_change_notifications_locked(
          v_existing.id,
          p_actor_user_id,
          'change_stale'
        );
      ELSE
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_ACTIVE_REQUEST'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  v_initial_status := CASE
    WHEN v_journey.state_revision IS DISTINCT FROM p_expected_revision
      THEN 'stale'
    ELSE 'pending'
  END;

  INSERT INTO public.couple_plan_change_requests(
    id,
    couple_id,
    actor_user_id,
    base_revision,
    changes,
    change_digest,
    roster_fingerprint,
    surface_href,
    summary,
    is_high_impact,
    required_count,
    status,
    created_at,
    expires_at,
    actor_accepted_at,
    stale_at,
    stale_reason
  ) VALUES (
    v_request_id,
    p_couple_id,
    p_actor_user_id,
    p_expected_revision,
    v_changes,
    v_change_digest,
    v_roster_fingerprint,
    p_surface,
    v_summary,
    v_is_high_impact,
    v_required_count,
    v_initial_status,
    v_now,
    v_now + interval '24 hours',
    v_now,
    CASE WHEN v_initial_status = 'stale' THEN v_now ELSE NULL END,
    CASE
      WHEN v_initial_status = 'stale' THEN 'revision_changed'
      ELSE NULL
    END
  );

  INSERT INTO public.couple_plan_change_acceptances(
    request_id,
    couple_id,
    user_id,
    change_digest,
    roster_fingerprint,
    accepted_at
  ) VALUES (
    v_request_id,
    p_couple_id,
    p_actor_user_id,
    v_change_digest,
    v_roster_fingerprint,
    v_now
  );

  IF v_initial_status = 'stale' THEN
    RETURN public.couple_plan_change_result(v_request_id);
  END IF;

  IF v_required_count = 1 THEN
    UPDATE public.couple_plan_change_requests AS request
    SET status = 'applying',
        applying_at = clock_timestamp()
    WHERE request.id = v_request_id
      AND request.status = 'pending';

    PERFORM public.apply_couple_plan_change_locked(
      v_request_id,
      p_actor_user_id
    );
    RETURN public.couple_plan_change_result(v_request_id);
  END IF;

  INSERT INTO public.couple_change_notifications(
    couple_id,
    recipient_user_id,
    actor_user_id,
    source_message_id,
    action_id,
    event_kind,
    tool_name,
    title,
    message,
    href
  ) VALUES
    (
      p_couple_id,
      v_partner_user_id,
      p_actor_user_id,
      v_request_id,
      v_request_id,
      'approval_requested',
      'manual_plan_change',
      '함께 확인할 계획 변경이 있어요',
      v_summary,
      p_surface
    ),
    (
      p_couple_id,
      p_actor_user_id,
      p_actor_user_id,
      v_request_id,
      v_request_id,
      'approval_pending',
      'manual_plan_change',
      '파트너 확인을 기다리는 계획 변경이에요',
      v_summary,
      p_surface
    )
  ON CONFLICT (
    couple_id, recipient_user_id, action_id, event_kind
  ) DO NOTHING;

  RETURN public.couple_plan_change_result(v_request_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_couple_plan_change_status(
  p_request_id uuid,
  p_couple_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_revision bigint;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_stale_reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL
     OR p_couple_id IS NULL
     OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;
  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT journey.state_revision
    INTO v_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id
    AND request.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = 'pending' THEN
    v_stale_reason := CASE
      WHEN v_request.expires_at <= clock_timestamp() THEN 'expired'
      WHEN v_request.roster_fingerprint IS DISTINCT FROM
        v_roster_fingerprint THEN 'roster_changed'
      WHEN v_request.base_revision IS DISTINCT FROM v_revision
        THEN 'revision_changed'
      ELSE NULL
    END;
    IF v_stale_reason IS NOT NULL THEN
      UPDATE public.couple_plan_change_requests AS request
      SET status = 'stale',
          stale_at = clock_timestamp(),
          stale_reason = v_stale_reason
      WHERE request.id = v_request.id
        AND request.status = 'pending';
      PERFORM public.finalize_couple_plan_change_notifications_locked(
        v_request.id,
        p_actor_user_id,
        'change_stale'
      );
    END IF;
  END IF;

  RETURN public.couple_plan_change_result(p_request_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_couple_plan_change(
  p_request_id uuid,
  p_couple_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_revision bigint;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_accepted_count integer;
  v_stale_reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL
     OR p_couple_id IS NULL
     OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;
  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT journey.state_revision
    INTO v_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id
    AND request.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;

  v_stale_reason := CASE
    WHEN v_request.expires_at <= clock_timestamp() THEN 'expired'
    WHEN v_request.roster_fingerprint IS DISTINCT FROM
      v_roster_fingerprint THEN 'roster_changed'
    WHEN v_request.base_revision IS DISTINCT FROM v_revision
      THEN 'revision_changed'
    ELSE NULL
  END;
  IF v_stale_reason IS NOT NULL THEN
    UPDATE public.couple_plan_change_requests AS request
    SET status = 'stale',
        stale_at = clock_timestamp(),
        stale_reason = v_stale_reason
    WHERE request.id = v_request.id
      AND request.status = 'pending';
    PERFORM public.finalize_couple_plan_change_notifications_locked(
      v_request.id,
      p_actor_user_id,
      'change_stale'
    );
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;

  INSERT INTO public.couple_plan_change_acceptances(
    request_id,
    couple_id,
    user_id,
    change_digest,
    roster_fingerprint,
    accepted_at
  ) VALUES (
    v_request.id,
    v_request.couple_id,
    p_actor_user_id,
    v_request.change_digest,
    v_request.roster_fingerprint,
    clock_timestamp()
  )
  ON CONFLICT (request_id, user_id) DO NOTHING;

  SELECT count(*)::integer
    INTO v_accepted_count
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = v_request.id
    AND acceptance.couple_id = v_request.couple_id
    AND acceptance.change_digest = v_request.change_digest
    AND acceptance.roster_fingerprint = v_request.roster_fingerprint
    AND acceptance.user_id IN (v_bride_id, v_groom_id);

  IF v_accepted_count < v_request.required_count THEN
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;

  UPDATE public.couple_plan_change_requests AS request
  SET status = 'applying',
      applying_at = clock_timestamp()
  WHERE request.id = v_request.id
    AND request.status = 'pending';
  IF NOT FOUND THEN
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;

  PERFORM public.apply_couple_plan_change_locked(
    p_request_id,
    p_actor_user_id
  );
  RETURN public.couple_plan_change_result(p_request_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_couple_plan_change(
  p_request_id uuid,
  p_couple_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_revision bigint;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_stale_reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL
     OR p_couple_id IS NULL
     OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;
  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT journey.state_revision
    INTO v_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id
    AND request.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;

  v_stale_reason := CASE
    WHEN v_request.expires_at <= clock_timestamp() THEN 'expired'
    WHEN v_request.roster_fingerprint IS DISTINCT FROM
      v_roster_fingerprint THEN 'roster_changed'
    WHEN v_request.base_revision IS DISTINCT FROM v_revision
      THEN 'revision_changed'
    ELSE NULL
  END;
  IF v_stale_reason IS NOT NULL THEN
    UPDATE public.couple_plan_change_requests AS request
    SET status = 'stale',
        stale_at = clock_timestamp(),
        stale_reason = v_stale_reason
    WHERE request.id = v_request.id
      AND request.status = 'pending';
    PERFORM public.finalize_couple_plan_change_notifications_locked(
      v_request.id,
      p_actor_user_id,
      'change_stale'
    );
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;

  UPDATE public.couple_plan_change_requests AS request
  SET status = 'rejected',
      rejected_at = clock_timestamp(),
      rejected_by_user_id = p_actor_user_id
  WHERE request.id = v_request.id
    AND request.status = 'pending';

  PERFORM public.finalize_couple_plan_change_notifications_locked(
    v_request.id,
    p_actor_user_id,
    'change_rejected'
  );

  RETURN public.couple_plan_change_result(p_request_id);
END;
$function$;

ALTER FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) OWNER TO postgres;
ALTER FUNCTION public.get_couple_plan_change_status(uuid, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.accept_couple_plan_change(uuid, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.reject_couple_plan_change(uuid, uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_couple_plan_change_status(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_couple_plan_change(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_couple_plan_change(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_couple_plan_change_status(
  uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_couple_plan_change(
  uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_couple_plan_change(
  uuid, uuid, uuid
) TO service_role;

COMMENT ON TABLE public.couple_plan_change_requests IS
  'Service-only durable CAS requests for manual shared wedding-plan changes.';
COMMENT ON TABLE public.couple_plan_change_acceptances IS
  'Digest- and roster-bound current-member acceptances for plan changes.';
COMMENT ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) IS
  'Submit a normalized plan patch; routine/solo applies now, linked high impact waits for 2/2.';

DO $postchecks$
BEGIN
  IF to_regclass('public.couple_plan_change_requests') IS NULL
     OR to_regclass('public.couple_plan_change_acceptances') IS NULL
     OR NOT (
       SELECT class.relrowsecurity
       FROM pg_catalog.pg_class AS class
       WHERE class.oid = 'public.couple_plan_change_requests'::regclass
     )
     OR NOT (
       SELECT class.relrowsecurity
       FROM pg_catalog.pg_class AS class
       WHERE class.oid = 'public.couple_plan_change_acceptances'::regclass
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.wedding_journeys'::regclass
         AND trigger.tgname =
           'trg_00_enforce_couple_plan_change_write_boundary'
         AND NOT trigger.tgisinternal
         AND trigger.tgenabled = 'O'
     )
     OR has_table_privilege(
       'authenticated',
       'public.couple_plan_change_requests',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.couple_plan_change_acceptances',
       'SELECT'
     )
     OR has_function_privilege(
       'authenticated',
       'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.get_couple_plan_change_status(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.accept_couple_plan_change(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.reject_couple_plan_change(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.apply_couple_plan_change_locked(uuid,uuid)',
       'EXECUTE'
     )
     OR (
       SELECT count(*)::integer
       FROM pg_catalog.pg_constraint AS constraint_record
       WHERE constraint_record.contype = 'f'
         AND constraint_record.confrelid = 'auth.users'::regclass
         AND constraint_record.conrelid IN (
           'public.couple_plan_change_requests'::regclass,
           'public.couple_plan_change_acceptances'::regclass
         )
         AND constraint_record.confdeltype = 'c'
     ) <> 4
     OR to_regprocedure(
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
