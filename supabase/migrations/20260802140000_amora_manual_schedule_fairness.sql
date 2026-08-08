BEGIN;

-- Manual schedule writes use the durable couple-plan request ledger. This
-- migration keeps the pre-existing budget/venue/date policy intact while
-- making every __events mutation an exact, auditable high-impact change.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Preserve the reviewed pre-schedule implementations by OID once. The public
-- names below remain stable for every existing caller and for migration reruns.
DO $block$
BEGIN
  IF to_regprocedure(
       'public.couple_plan_change_is_high_impact_before_manual_schedule(date,date,text,text,bigint,bigint,jsonb,jsonb)'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.couple_plan_change_is_high_impact(date,date,text,text,bigint,bigint,jsonb,jsonb)'
       ) IS NULL THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_BASE_FUNCTION_MISSING'
        USING ERRCODE = '55000';
    END IF;
    ALTER FUNCTION public.couple_plan_change_is_high_impact(
      date, date, text, text, bigint, bigint, jsonb, jsonb
    ) RENAME TO couple_plan_change_is_high_impact_before_manual_schedule;
  END IF;

  IF to_regprocedure(
       'public.couple_plan_change_exact_high_summary_before_manual_schedule(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.couple_plan_change_exact_high_summary(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
       ) IS NULL THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_BASE_FUNCTION_MISSING'
        USING ERRCODE = '55000';
    END IF;
    ALTER FUNCTION public.couple_plan_change_exact_high_summary(
      date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
    ) RENAME TO couple_plan_change_exact_high_summary_before_manual_schedule;
  END IF;

  IF to_regprocedure(
       'public.submit_couple_plan_change_before_manual_schedule_clock(uuid,uuid,bigint,jsonb,text,text)'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)'
       ) IS NULL THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_BASE_FUNCTION_MISSING'
        USING ERRCODE = '55000';
    END IF;
    ALTER FUNCTION public.submit_couple_plan_change(
      uuid, uuid, bigint, jsonb, text, text
    ) RENAME TO submit_couple_plan_change_before_manual_schedule_clock;
  END IF;
END
$block$;

-- The booking outbox predates the couple-plan write boundary. Its projection
-- RPC already proves a claimed job generation and locks job -> journey, but a
-- direct UPDATE from the service role must never gain the same authority. Keep
-- the reviewed implementation behind a wrapper and mint one unguessable,
-- transaction-local capability for exactly the journey UPDATE it performs.
DO $block$
BEGIN
  IF to_regprocedure(
       'public.apply_booking_progress_projection_before_manual_schedule(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.apply_booking_progress_projection(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)'
       ) IS NULL THEN
      RAISE EXCEPTION 'AMORA_BOOKING_PROJECTION_BASE_FUNCTION_MISSING'
        USING ERRCODE = '55000';
    END IF;
    ALTER FUNCTION public.apply_booking_progress_projection(
      uuid, uuid, text, jsonb, text, numeric, bigint, uuid
    ) RENAME TO apply_booking_progress_projection_before_manual_schedule;
  END IF;
END
$block$;

CREATE TABLE IF NOT EXISTS public.booking_projection_write_authorizations (
  authorization_id uuid PRIMARY KEY,
  couple_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  desired_state text NOT NULL CHECK (desired_state IN ('active', 'cancelled')),
  generation bigint NOT NULL CHECK (generation >= 1),
  claim_token uuid NOT NULL,
  transaction_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at >= created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

ALTER TABLE public.booking_projection_write_authorizations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_projection_write_authorizations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.booking_projection_write_authorizations OWNER TO postgres;
REVOKE ALL ON TABLE public.booking_projection_write_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.authorize_booking_projection_journey_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_authorization text := NULLIF(current_setting(
    'hanbang.booking_projection_authorization_id', true
  ), '');
  v_authorized_id uuid;
  v_alias_operation text;
BEGIN
  IF v_authorization IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_authorization !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR NULLIF(current_setting(
          'hanbang.booking_projection_boundary_authorized', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_couple_id', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_request_key', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_operation_key', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_action_id', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_expected_revision', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_applied_revision', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.couple_plan_change_request_id', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.couple_plan_change_couple_id', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.couple_plan_change_base_revision', true
        ), '') IS NOT NULL
     OR NULLIF(current_setting(
          'hanbang.couple_plan_change_digest', true
        ), '') IS NOT NULL
     OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
     OR NEW.state_revision IS DISTINCT FROM OLD.state_revision
     OR (to_jsonb(NEW) - ARRAY[
           'progress', 'updated_at', 'state_revision'
        ]::text[]) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY[
           'progress', 'updated_at', 'state_revision'
        ]::text[]) THEN
    RAISE EXCEPTION 'BOOKING_PROJECTION_WRITE_NOT_AUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.booking_projection_write_authorizations AS write_auth
  SET consumed_at = clock_timestamp()
  FROM public.booking_projection_jobs AS job,
       public.vendor_bookings AS booking
  WHERE write_auth.authorization_id = v_authorization::uuid
    AND write_auth.couple_id = OLD.couple_id
    AND write_auth.transaction_id = txid_current()
    AND write_auth.consumed_at IS NULL
    AND write_auth.expires_at >= clock_timestamp()
    AND job.booking_id = write_auth.booking_id
    AND job.couple_id = write_auth.couple_id
    AND job.desired_state = write_auth.desired_state
    AND job.generation = write_auth.generation
    AND job.claim_token = write_auth.claim_token
    AND job.status = 'processing'
    AND booking.id = write_auth.booking_id
    AND booking.couple_id = write_auth.couple_id
  RETURNING write_auth.authorization_id INTO v_authorized_id;

  IF v_authorized_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_PROJECTION_WRITE_NOT_AUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  -- The legacy boundary has an existing, downstream-verified Amora route but
  -- no booking route. These aliases live only between two adjacent BEFORE
  -- triggers: the boundary sees a complete set, then the clear trigger removes
  -- it before the Amora revision/receipt triggers run. The capability row is
  -- the authority; these values alone are never accepted.
  v_alias_operation := md5(v_authorized_id::text)
    || md5('booking-projection:' || v_authorized_id::text);
  PERFORM set_config(
    'hanbang.booking_projection_boundary_authorized',
    v_authorized_id::text,
    true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_couple_id', OLD.couple_id::text, true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_request_key',
    'booking-projection:' || v_authorized_id::text,
    true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_operation_key', v_alias_operation, true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_action_id', v_authorized_id::text, true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_expected_revision',
    OLD.state_revision::text,
    true
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_booking_projection_boundary_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_authorization text := NULLIF(current_setting(
    'hanbang.booking_projection_authorization_id', true
  ), '');
  v_boundary_authorization text := NULLIF(current_setting(
    'hanbang.booking_projection_boundary_authorized', true
  ), '');
  v_alias_operation text;
BEGIN
  IF v_authorization IS NULL AND v_boundary_authorization IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_authorization IS NULL
     OR v_boundary_authorization IS DISTINCT FROM v_authorization
     OR v_authorization !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR NOT EXISTS (
       SELECT 1
       FROM public.booking_projection_write_authorizations AS write_auth
       WHERE write_auth.authorization_id = v_authorization::uuid
         AND write_auth.couple_id = OLD.couple_id
         AND write_auth.transaction_id = txid_current()
         AND write_auth.consumed_at IS NOT NULL
         AND write_auth.expires_at >= clock_timestamp()
     ) THEN
    RAISE EXCEPTION 'BOOKING_PROJECTION_BOUNDARY_ALIAS_INVALID'
      USING ERRCODE = '42501';
  END IF;

  v_alias_operation := md5(v_authorization)
    || md5('booking-projection:' || v_authorization);
  IF NULLIF(current_setting(
       'hanbang.amora_shared_action_couple_id', true
     ), '') IS DISTINCT FROM OLD.couple_id::text
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_request_key', true
        ), '') IS DISTINCT FROM 'booking-projection:' || v_authorization
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_operation_key', true
        ), '') IS DISTINCT FROM v_alias_operation
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_action_id', true
        ), '') IS DISTINCT FROM v_authorization
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_expected_revision', true
        ), '') IS DISTINCT FROM OLD.state_revision::text
     OR NULLIF(current_setting(
          'hanbang.amora_shared_action_applied_revision', true
        ), '') IS NOT NULL THEN
    RAISE EXCEPTION 'BOOKING_PROJECTION_BOUNDARY_ALIAS_INVALID'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('hanbang.amora_shared_action_couple_id', '', true);
  PERFORM set_config('hanbang.amora_shared_action_request_key', '', true);
  PERFORM set_config('hanbang.amora_shared_action_operation_key', '', true);
  PERFORM set_config('hanbang.amora_shared_action_action_id', '', true);
  PERFORM set_config(
    'hanbang.amora_shared_action_expected_revision', '', true
  );
  PERFORM set_config(
    'hanbang.booking_projection_boundary_authorized', '', true
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_authorize_booking_projection
  ON public.wedding_journeys;
CREATE TRIGGER trg_00_authorize_booking_projection
  BEFORE UPDATE ON public.wedding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.authorize_booking_projection_journey_write();

DROP TRIGGER IF EXISTS trg_01_clear_booking_projection_boundary_alias
  ON public.wedding_journeys;
CREATE TRIGGER trg_01_clear_booking_projection_boundary_alias
  BEFORE UPDATE ON public.wedding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_booking_projection_boundary_alias();

CREATE OR REPLACE FUNCTION public.apply_booking_progress_projection(
  p_couple_id uuid,
  p_booking_id uuid,
  p_desired_state text,
  p_event jsonb,
  p_category_key text,
  p_amount numeric,
  p_generation bigint,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '60s'
AS $function$
DECLARE
  v_authorization_id uuid := gen_random_uuid();
  v_result jsonb;
  v_consumed_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_desired_state NOT IN ('active', 'cancelled')
     OR p_generation IS NULL
     OR p_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid_booking_projection_authorization'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.booking_projection_write_authorizations(
    authorization_id,
    couple_id,
    booking_id,
    desired_state,
    generation,
    claim_token,
    transaction_id,
    expires_at
  ) VALUES (
    v_authorization_id,
    p_couple_id,
    p_booking_id,
    p_desired_state,
    p_generation,
    p_claim_token,
    txid_current(),
    clock_timestamp() + interval '5 minutes'
  );
  PERFORM set_config(
    'hanbang.booking_projection_authorization_id',
    v_authorization_id::text,
    true
  );

  v_result :=
    public.apply_booking_progress_projection_before_manual_schedule(
      p_couple_id,
      p_booking_id,
      p_desired_state,
      p_event,
      p_category_key,
      p_amount,
      p_generation,
      p_claim_token
    );

  DELETE FROM public.booking_projection_write_authorizations
  WHERE authorization_id = v_authorization_id
  RETURNING consumed_at INTO v_consumed_at;
  IF NOT FOUND
     OR ((v_result ->> 'accepted') = 'true') IS DISTINCT FROM
        (v_consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'BOOKING_PROJECTION_AUTHORIZATION_NOT_CONSUMED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('hanbang.booking_projection_authorization_id', '', true);
  PERFORM set_config(
    'hanbang.booking_projection_boundary_authorized', '', true
  );
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'hanbang.booking_projection_authorization_id', '', true
    );
    PERFORM set_config(
      'hanbang.booking_projection_boundary_authorized', '', true
    );
    PERFORM set_config('hanbang.amora_shared_action_couple_id', '', true);
    PERFORM set_config('hanbang.amora_shared_action_request_key', '', true);
    PERFORM set_config('hanbang.amora_shared_action_operation_key', '', true);
    PERFORM set_config('hanbang.amora_shared_action_action_id', '', true);
    PERFORM set_config(
      'hanbang.amora_shared_action_expected_revision', '', true
    );
    RAISE;
END;
$function$;

ALTER FUNCTION public.apply_booking_progress_projection_before_manual_schedule(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) OWNER TO postgres;
ALTER FUNCTION public.authorize_booking_projection_journey_write()
  OWNER TO postgres;
ALTER FUNCTION public.clear_booking_projection_boundary_alias()
  OWNER TO postgres;
ALTER FUNCTION public.apply_booking_progress_projection(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION
  public.apply_booking_progress_projection_before_manual_schedule(
    uuid, uuid, text, jsonb, text, numeric, bigint, uuid
  ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.authorize_booking_projection_journey_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_booking_projection_boundary_alias()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_booking_progress_projection(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_booking_progress_projection(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.amora_manual_schedule_event_is_valid(
  p_event jsonb,
  p_bride_id uuid,
  p_groom_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_date date;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_cancelled_at timestamptz;
  v_profile_id uuid;
  v_assignee jsonb;
  v_cancellation jsonb;
  v_status text;
  v_text text;
BEGIN
  IF p_event IS NULL
     OR jsonb_typeof(p_event) IS DISTINCT FROM 'object'
     OR p_event - ARRAY[
       'id', 'date', 'time', 'title', 'memo', 'categoryKey', 'sourceKey',
       'momentType', 'status', 'completionCriteria', 'assignee', 'createdAt',
       'updatedAt', 'cancellation'
     ]::text[] <> '{}'::jsonb
     OR jsonb_typeof(p_event -> 'id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_event -> 'date') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_event -> 'title') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_event -> 'createdAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_event -> 'updatedAt') IS DISTINCT FROM 'string'
     OR char_length(p_event ->> 'id') NOT BETWEEN 1 AND 200
     OR p_event ->> 'id' IS DISTINCT FROM btrim(p_event ->> 'id')
     OR public.couple_plan_change_has_unsafe_display_text(p_event ->> 'id')
     OR char_length(p_event ->> 'title') NOT BETWEEN 1 AND 500
     OR p_event ->> 'title' IS DISTINCT FROM btrim(p_event ->> 'title')
     OR public.couple_plan_change_has_unsafe_display_text(p_event ->> 'title')
     OR p_event ->> 'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR char_length(p_event ->> 'createdAt') NOT BETWEEN 1 AND 100
     OR char_length(p_event ->> 'updatedAt') NOT BETWEEN 1 AND 100
     OR p_event ->> 'createdAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
     OR p_event ->> 'updatedAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' THEN
    RETURN false;
  END IF;

  v_date := (p_event ->> 'date')::date;
  IF to_char(v_date, 'YYYY-MM-DD') IS DISTINCT FROM p_event ->> 'date' THEN
    RETURN false;
  END IF;
  v_created_at := (p_event ->> 'createdAt')::timestamptz;
  v_updated_at := (p_event ->> 'updatedAt')::timestamptz;
  IF v_updated_at < v_created_at THEN
    RETURN false;
  END IF;

  IF p_event ? 'time' THEN
    IF jsonb_typeof(p_event -> 'time') IS DISTINCT FROM 'string'
       OR p_event ->> 'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN false;
    END IF;
  END IF;

  FOREACH v_text IN ARRAY ARRAY[
    'memo', 'categoryKey', 'sourceKey', 'momentType', 'completionCriteria'
  ]::text[] LOOP
    IF p_event ? v_text AND (
      jsonb_typeof(p_event -> v_text) IS DISTINCT FROM 'string'
      OR char_length(p_event ->> v_text) > CASE v_text
        WHEN 'memo' THEN 2000
        WHEN 'categoryKey' THEN 100
        WHEN 'sourceKey' THEN 200
        WHEN 'momentType' THEN 100
        ELSE 500
      END
      OR public.couple_plan_change_has_unsafe_display_text(
        p_event ->> v_text
      )
    ) THEN
      RETURN false;
    END IF;
  END LOOP;

  v_status := COALESCE(p_event ->> 'status', 'planned');
  IF v_status NOT IN ('planned', 'completed', 'cancelled')
     OR (
       p_event ? 'status'
       AND jsonb_typeof(p_event -> 'status') IS DISTINCT FROM 'string'
     ) THEN
    RETURN false;
  END IF;

  v_assignee := p_event -> 'assignee';
  IF v_assignee IS NOT NULL THEN
    IF jsonb_typeof(v_assignee) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_assignee -> 'kind') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    IF v_assignee ->> 'kind' = 'member' THEN
      IF v_assignee - ARRAY['kind', 'profileId']::text[] <> '{}'::jsonb
         OR jsonb_typeof(v_assignee -> 'profileId') IS DISTINCT FROM 'string'
         OR v_assignee ->> 'profileId' !~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN false;
      END IF;
      v_profile_id := (v_assignee ->> 'profileId')::uuid;
      IF v_profile_id IS DISTINCT FROM p_bride_id
         AND v_profile_id IS DISTINCT FROM p_groom_id THEN
        RETURN false;
      END IF;
    ELSIF v_assignee ->> 'kind' = 'couple' THEN
      IF v_assignee - 'kind' <> '{}'::jsonb THEN
        RETURN false;
      END IF;
    ELSIF v_assignee ->> 'kind' = 'external' THEN
      IF v_assignee - ARRAY['kind', 'label']::text[] <> '{}'::jsonb
         OR jsonb_typeof(v_assignee -> 'label') IS DISTINCT FROM 'string'
         OR char_length(v_assignee ->> 'label') NOT BETWEEN 1 AND 80
         OR v_assignee ->> 'label' IS DISTINCT FROM
            btrim(v_assignee ->> 'label')
         OR public.couple_plan_change_has_unsafe_display_text(
           v_assignee ->> 'label'
         ) THEN
        RETURN false;
      END IF;
    ELSE
      RETURN false;
    END IF;
  END IF;

  v_cancellation := p_event -> 'cancellation';
  IF v_status = 'cancelled' THEN
    IF jsonb_typeof(v_cancellation) IS DISTINCT FROM 'object'
       OR v_cancellation - ARRAY[
         'cancelledAt', 'cancelledByProfileId', 'reason'
       ]::text[] <> '{}'::jsonb
       OR jsonb_typeof(v_cancellation -> 'cancelledAt')
          IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_cancellation -> 'cancelledByProfileId')
          IS DISTINCT FROM 'string'
       OR v_cancellation ->> 'cancelledAt' !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
       OR v_cancellation ->> 'cancelledByProfileId' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    v_cancelled_at := (v_cancellation ->> 'cancelledAt')::timestamptz;
    v_profile_id := (v_cancellation ->> 'cancelledByProfileId')::uuid;
    IF v_profile_id IS DISTINCT FROM p_bride_id
       AND v_profile_id IS DISTINCT FROM p_groom_id
       OR v_cancelled_at IS DISTINCT FROM v_updated_at
       OR v_cancellation ->> 'cancelledAt' IS DISTINCT FROM
          p_event ->> 'updatedAt' THEN
      RETURN false;
    END IF;
    IF v_cancellation ? 'reason' AND (
      jsonb_typeof(v_cancellation -> 'reason') IS DISTINCT FROM 'string'
      OR char_length(v_cancellation ->> 'reason') NOT BETWEEN 1 AND 500
      OR v_cancellation ->> 'reason' IS DISTINCT FROM
         btrim(v_cancellation ->> 'reason')
      OR public.couple_plan_change_has_unsafe_display_text(
        v_cancellation ->> 'reason'
      )
    ) THEN
      RETURN false;
    END IF;
  ELSIF v_cancellation IS NOT NULL THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.amora_manual_schedule_assignee_label(
  p_assignee jsonb,
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
  v_profile_id uuid;
BEGIN
  IF p_assignee IS NULL OR p_assignee = 'null'::jsonb THEN
    RETURN '미정';
  END IF;
  IF p_assignee ->> 'kind' = 'couple' THEN
    RETURN '함께';
  END IF;
  IF p_assignee ->> 'kind' = 'external' THEN
    RETURN '외부 ' || (p_assignee ->> 'label');
  END IF;
  IF p_assignee ->> 'kind' = 'member' THEN
    v_profile_id := (p_assignee ->> 'profileId')::uuid;
    IF v_profile_id = p_bride_id THEN
      RETURN '예비 신부';
    END IF;
    IF v_profile_id = p_groom_id THEN
      RETURN '예비 신랑';
    END IF;
  END IF;
  RETURN '확인 필요';
EXCEPTION WHEN OTHERS THEN
  RETURN '확인 필요';
END;
$function$;

CREATE OR REPLACE FUNCTION public.amora_manual_schedule_field_value(
  p_event jsonb,
  p_field text,
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
  v_value text;
BEGIN
  IF p_field = 'assignee' THEN
    RETURN public.amora_manual_schedule_assignee_label(
      p_event -> 'assignee', p_bride_id, p_groom_id
    );
  END IF;
  IF p_field = 'status' THEN
    RETURN CASE COALESCE(p_event ->> 'status', 'planned')
      WHEN 'planned' THEN '예정'
      WHEN 'completed' THEN '완료'
      WHEN 'cancelled' THEN '취소'
      ELSE '확인 필요'
    END;
  END IF;
  v_value := p_event ->> p_field;
  RETURN COALESCE(NULLIF(v_value, ''), '없음');
END;
$function$;

CREATE OR REPLACE FUNCTION public.amora_manual_schedule_delta(
  p_old_progress jsonb,
  p_new_progress jsonb,
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
  v_old_events jsonb;
  v_new_events jsonb;
  v_old_count integer;
  v_new_count integer;
  v_index integer;
  v_changed_count integer := 0;
  v_before jsonb;
  v_after jsonb;
  v_kind text;
  v_field text;
  v_label text;
  v_before_status text;
  v_after_status text;
  v_summary text;
  v_segment text;
  v_changed_labels text := '';
  v_title_summary text;
  v_schedule_identity text;
  v_delta_digest text;
BEGIN
  IF jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object'
     OR jsonb_typeof(COALESCE(p_new_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object'
     OR (COALESCE(p_old_progress, '{}'::jsonb) - '__events')
        IS DISTINCT FROM
        (COALESCE(p_new_progress, '{}'::jsonb) - '__events') THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_MIXED_DELTA_DENIED'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_old_progress, '{}'::jsonb) ? '__events' THEN
    IF jsonb_typeof(p_old_progress -> '__events') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_EVENT_ARRAY'
        USING ERRCODE = '22023';
    END IF;
    v_old_events := p_old_progress -> '__events';
  ELSE
    v_old_events := '[]'::jsonb;
  END IF;
  IF COALESCE(p_new_progress, '{}'::jsonb) ? '__events' THEN
    IF jsonb_typeof(p_new_progress -> '__events') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_EVENT_ARRAY'
        USING ERRCODE = '22023';
    END IF;
    v_new_events := p_new_progress -> '__events';
  ELSE
    v_new_events := '[]'::jsonb;
  END IF;

  IF v_old_events IS NOT DISTINCT FROM v_new_events THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_NO_EVENT_DELTA'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_old_events) > 500
     OR jsonb_array_length(v_new_events) > 500
     OR octet_length(v_old_events::text) > 1572864
     OR octet_length(v_new_events::text) > 1572864
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_old_events) AS event(value)
       WHERE jsonb_typeof(event.value) IS DISTINCT FROM 'object'
          OR jsonb_typeof(event.value -> 'id') IS DISTINCT FROM 'string'
          OR char_length(btrim(event.value ->> 'id')) NOT BETWEEN 1 AND 200
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_new_events) AS event(value)
       WHERE jsonb_typeof(event.value) IS DISTINCT FROM 'object'
          OR jsonb_typeof(event.value -> 'id') IS DISTINCT FROM 'string'
          OR char_length(btrim(event.value ->> 'id')) NOT BETWEEN 1 AND 200
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_old_events) AS event(value)
       GROUP BY event.value ->> 'id' HAVING count(*) > 1
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_new_events) AS event(value)
       GROUP BY event.value ->> 'id' HAVING count(*) > 1
     ) THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_EVENT_ARRAY'
      USING ERRCODE = '22023';
  END IF;

  v_old_count := jsonb_array_length(v_old_events);
  v_new_count := jsonb_array_length(v_new_events);
  IF v_new_count = v_old_count - 1 THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_HARD_DELETE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF v_new_count = v_old_count + 1 THEN
    v_kind := 'add';
    IF v_old_count > 0 THEN
      FOR v_index IN 0..v_old_count - 1 LOOP
        IF v_old_events -> v_index IS DISTINCT FROM v_new_events -> v_index THEN
          RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_ADD_NOT_APPEND_ONLY'
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    v_after := v_new_events -> v_old_count;
    IF NOT public.amora_manual_schedule_event_is_valid(
         v_after, p_bride_id, p_groom_id
       )
       OR COALESCE(v_after ->> 'status', 'planned') = 'cancelled'
       OR v_after ? 'cancellation'
       OR v_after ->> 'createdAt' IS DISTINCT FROM v_after ->> 'updatedAt' THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_ADD'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_new_count = v_old_count THEN
    IF v_old_count = 0 THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_UNSUPPORTED_DELTA'
        USING ERRCODE = '22023';
    END IF;
    FOR v_index IN 0..v_old_count - 1 LOOP
      IF v_old_events -> v_index ->> 'id' IS DISTINCT FROM
         v_new_events -> v_index ->> 'id' THEN
        RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_ORDER_OR_ID_CHANGED'
          USING ERRCODE = '22023';
      END IF;
      IF v_old_events -> v_index IS DISTINCT FROM v_new_events -> v_index THEN
        v_changed_count := v_changed_count + 1;
        v_before := v_old_events -> v_index;
        v_after := v_new_events -> v_index;
      END IF;
    END LOOP;
    IF v_changed_count <> 1
       OR NOT public.amora_manual_schedule_event_is_valid(
         v_before, p_bride_id, p_groom_id
       )
       OR NOT public.amora_manual_schedule_event_is_valid(
         v_after, p_bride_id, p_groom_id
       )
       OR v_before ->> 'id' IS DISTINCT FROM v_after ->> 'id'
       OR v_before ->> 'createdAt' IS DISTINCT FROM v_after ->> 'createdAt'
       OR v_before ->> 'updatedAt' IS NOT DISTINCT FROM v_after ->> 'updatedAt'
       OR (v_after ->> 'updatedAt')::timestamptz <=
          (v_before ->> 'updatedAt')::timestamptz THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_UPDATE'
        USING ERRCODE = '22023';
    END IF;

    v_before_status := COALESCE(v_before ->> 'status', 'planned');
    v_after_status := COALESCE(v_after ->> 'status', 'planned');
    IF v_before_status <> 'cancelled' AND v_after_status = 'cancelled' THEN
      v_kind := 'cancel';
      IF (v_before - ARRAY['status', 'cancellation', 'updatedAt']::text[])
           IS DISTINCT FROM
         (v_after - ARRAY['status', 'cancellation', 'updatedAt']::text[])
         OR (v_after #>> '{cancellation,cancelledAt}')::timestamptz <
            (v_before ->> 'updatedAt')::timestamptz THEN
        RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_CANCEL'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_before_status = 'cancelled'
          AND v_after_status = 'planned'
          AND v_after ? 'status' THEN
      v_kind := 'restore';
      IF v_after ? 'cancellation'
         OR (v_before - ARRAY['status', 'cancellation', 'updatedAt']::text[])
              IS DISTINCT FROM
            (v_after - ARRAY['status', 'cancellation', 'updatedAt']::text[]) THEN
        RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_RESTORE'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_before_status <> 'cancelled'
          AND v_after_status <> 'cancelled' THEN
      v_kind := 'update';
      IF (v_before - 'updatedAt') IS NOT DISTINCT FROM
         (v_after - 'updatedAt') THEN
        RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_EMPTY_UPDATE'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_CANCEL_STATE_INVALID'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_UNSUPPORTED_DELTA'
      USING ERRCODE = '22023';
  END IF;

  v_summary := '일정 ' || CASE v_kind
    WHEN 'add' THEN '추가'
    WHEN 'update' THEN '수정'
    WHEN 'cancel' THEN '취소'
    ELSE '복원'
  END || ': ' || COALESCE(NULLIF(btrim(COALESCE(
    v_before ->> 'title', v_after ->> 'title'
  )), ''), '제목 없음');
  v_schedule_identity := '날짜: ' ||
    public.amora_manual_schedule_field_value(
      v_before, 'date', p_bride_id, p_groom_id
    ) || ' → ' ||
    public.amora_manual_schedule_field_value(
      v_after, 'date', p_bride_id, p_groom_id
    ) || ' · 시간: ' ||
    public.amora_manual_schedule_field_value(
      v_before, 'time', p_bride_id, p_groom_id
    ) || ' → ' ||
    public.amora_manual_schedule_field_value(
      v_after, 'time', p_bride_id, p_groom_id
    );
  v_summary := v_summary || ' · ' || v_schedule_identity;
  IF v_kind = 'add' THEN
    v_changed_labels := '제목·날짜·시간';
  ELSE
    IF v_before -> 'date' IS DISTINCT FROM v_after -> 'date' THEN
      v_changed_labels := '날짜';
    END IF;
    IF v_before -> 'time' IS DISTINCT FROM v_after -> 'time' THEN
      v_changed_labels := CASE
        WHEN v_changed_labels = '' THEN '시간'
        ELSE v_changed_labels || '·시간'
      END;
    END IF;
  END IF;

  IF v_kind = 'add' THEN
    FOREACH v_field IN ARRAY ARRAY[
      'memo', 'categoryKey', 'sourceKey', 'momentType',
      'status', 'completionCriteria', 'assignee'
    ]::text[] LOOP
      IF v_field = 'status' OR v_after ? v_field THEN
        v_label := CASE v_field
          WHEN 'memo' THEN '메모'
          WHEN 'categoryKey' THEN '분류'
          WHEN 'sourceKey' THEN '출처 키'
          WHEN 'momentType' THEN '모먼트'
          WHEN 'status' THEN '상태'
          WHEN 'completionCriteria' THEN '완료 기준'
          ELSE '담당'
        END;
        v_changed_labels := CASE
          WHEN v_changed_labels = '' THEN v_label
          ELSE v_changed_labels || '·' || v_label
        END;
        v_segment := v_label || ': 없음 → ' ||
          public.amora_manual_schedule_field_value(
            v_after, v_field, p_bride_id, p_groom_id
          );
        v_summary := v_summary || ' · ' || v_segment;
      END IF;
    END LOOP;
  ELSIF v_kind = 'cancel' THEN
    v_changed_labels := '상태·취소 요청자';
    v_summary := v_summary || ' · 상태: ' ||
      public.amora_manual_schedule_field_value(
        v_before, 'status', p_bride_id, p_groom_id
      ) || ' → 취소 · 취소 요청자: ' ||
      public.amora_manual_schedule_assignee_label(
        jsonb_build_object(
          'kind', 'member',
          'profileId', v_after #>> '{cancellation,cancelledByProfileId}'
        ),
        p_bride_id,
        p_groom_id
      );
    IF v_after #> '{cancellation,reason}' IS NOT NULL THEN
      v_changed_labels := v_changed_labels || '·취소 사유';
      v_summary := v_summary || ' · 취소 사유: 없음 → ' ||
        CASE
          WHEN char_length(v_after #>> '{cancellation,reason}') <= 80
            THEN v_after #>> '{cancellation,reason}'
          ELSE '입력됨(' ||
            char_length(v_after #>> '{cancellation,reason}')::text ||
            '자, 지문 ' || encode(
              extensions.digest(
                convert_to(v_after #>> '{cancellation,reason}', 'UTF8'),
                'sha256'
              ),
              'hex'
            ) || ')'
        END;
    END IF;
  ELSE
    FOREACH v_field IN ARRAY ARRAY[
      'title', 'memo', 'categoryKey', 'sourceKey',
      'momentType', 'status', 'completionCriteria', 'assignee'
    ]::text[] LOOP
      IF COALESCE(v_before -> v_field, CASE
           WHEN v_field = 'status' THEN '"planned"'::jsonb ELSE NULL
         END) IS DISTINCT FROM
         COALESCE(v_after -> v_field, CASE
           WHEN v_field = 'status' THEN '"planned"'::jsonb ELSE NULL
         END) THEN
        v_label := CASE v_field
          WHEN 'title' THEN '제목'
          WHEN 'memo' THEN '메모'
          WHEN 'categoryKey' THEN '분류'
          WHEN 'sourceKey' THEN '출처 키'
          WHEN 'momentType' THEN '모먼트'
          WHEN 'status' THEN '상태'
          WHEN 'completionCriteria' THEN '완료 기준'
          ELSE '담당'
        END;
        v_changed_labels := CASE
          WHEN v_changed_labels = '' THEN v_label
          ELSE v_changed_labels || '·' || v_label
        END;
        v_segment := v_label || ': ' ||
          public.amora_manual_schedule_field_value(
            v_before, v_field, p_bride_id, p_groom_id
          ) || ' → ' ||
          public.amora_manual_schedule_field_value(
            v_after, v_field, p_bride_id, p_groom_id
          );
        v_summary := v_summary || ' · ' || v_segment;
      END IF;
    END LOOP;
    IF v_kind = 'restore' THEN
      v_changed_labels := CASE
        WHEN v_changed_labels = '' THEN '취소 기록'
        ELSE v_changed_labels || '·취소 기록'
      END;
      v_summary := v_summary || ' · 취소 기록: 있음 → 제거';
    END IF;
  END IF;

  -- Long user-authored fields remain byte-exact in before/after. The bounded
  -- approval copy names every changed core field and binds the full pair with
  -- a SHA-256 digest instead of rejecting an otherwise valid change.
  IF char_length(v_summary) > 240 THEN
    v_title_summary := COALESCE(NULLIF(btrim(COALESCE(
      v_before ->> 'title', v_after ->> 'title'
    )), ''), '제목 없음');
    IF char_length(v_title_summary) > 40 THEN
      v_title_summary := left(v_title_summary, 32) || '…(' ||
        char_length(v_title_summary)::text || '자)';
    END IF;
    v_delta_digest := encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'before', v_before,
            'after', v_after
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    v_summary := '일정 ' || CASE v_kind
      WHEN 'add' THEN '추가'
      WHEN 'update' THEN '수정'
      WHEN 'cancel' THEN '취소'
      ELSE '복원'
    END || ': ' || v_title_summary ||
      ' · ' || v_schedule_identity ||
      ' · 변경: ' || COALESCE(NULLIF(v_changed_labels, ''), '일정') ||
      ' · 변경 전→후 묶음 지문: ' || v_delta_digest;
  END IF;

  IF char_length(v_summary) NOT BETWEEN 1 AND 240
     OR public.couple_plan_change_has_unsafe_display_text(v_summary) THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_SUMMARY_TOO_LONG'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'mutationKind', v_kind,
    'eventId', v_after ->> 'id',
    'before', v_before,
    'after', v_after,
    'summary', v_summary
  );
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
  IF (COALESCE(p_old_progress, '{}'::jsonb) -> '__events')
       IS DISTINCT FROM
     (COALESCE(p_new_progress, '{}'::jsonb) -> '__events') THEN
    RETURN true;
  END IF;
  RETURN public.couple_plan_change_is_high_impact_before_manual_schedule(
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
  v_delta jsonb;
BEGIN
  IF (COALESCE(p_old_progress, '{}'::jsonb) -> '__events')
       IS DISTINCT FROM
     (COALESCE(p_new_progress, '{}'::jsonb) -> '__events') THEN
    IF p_old_wedding_date IS DISTINCT FROM p_new_wedding_date
       OR p_old_venue IS DISTINCT FROM p_new_venue
       OR p_old_total_budget IS DISTINCT FROM p_new_total_budget THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_MIXED_DELTA_DENIED'
        USING ERRCODE = '22023';
    END IF;
    v_delta := public.amora_manual_schedule_delta(
      p_old_progress,
      p_new_progress,
      p_bride_id,
      p_groom_id
    );
    RETURN v_delta ->> 'summary';
  END IF;
  RETURN public.couple_plan_change_exact_high_summary_before_manual_schedule(
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
END;
$function$;

-- The shared-action receipt migration originally understood only add/update.
-- Soft cancellation and restoration use the same consent and CAS authority,
-- but retain their exact semantic kind and immutable before/after evidence.
ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  DROP CONSTRAINT IF EXISTS amora_shared_schedule_receipt_delta_check;
ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  ADD CONSTRAINT amora_shared_schedule_receipt_delta_check CHECK (
    (
      mutation_kind IS NULL
      AND schedule_scope IS NULL
      AND schedule_event_id IS NULL
      AND before_event IS NULL
      AND after_event IS NULL
    )
    OR (
      mutation_kind = 'add'
      AND (
        schedule_scope IS NULL
        OR schedule_scope IN (
          'confirmed_fact', 'shared_commitment', 'external_commitment'
        )
      )
      AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
      AND before_event IS NULL
      AND jsonb_typeof(after_event) = 'object'
      AND after_event ->> 'id' = schedule_event_id
    )
    OR (
      mutation_kind = 'update'
      AND (
        schedule_scope IS NULL
        OR schedule_scope IN (
          'confirmed_fact', 'shared_commitment', 'external_commitment'
        )
      )
      AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
      AND jsonb_typeof(before_event) = 'object'
      AND jsonb_typeof(after_event) = 'object'
      AND before_event ->> 'id' = schedule_event_id
      AND after_event ->> 'id' = schedule_event_id
      AND before_event IS DISTINCT FROM after_event
    )
    OR (
      mutation_kind = 'cancel'
      AND schedule_scope IS NULL
      AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
      AND jsonb_typeof(before_event) = 'object'
      AND jsonb_typeof(after_event) = 'object'
      AND before_event ->> 'id' = schedule_event_id
      AND after_event ->> 'id' = schedule_event_id
      AND COALESCE(before_event ->> 'status', 'planned') <> 'cancelled'
      AND after_event ->> 'status' = 'cancelled'
      AND jsonb_typeof(after_event -> 'cancellation') = 'object'
      AND before_event IS DISTINCT FROM after_event
    )
    OR (
      mutation_kind = 'restore'
      AND schedule_scope IS NULL
      AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
      AND jsonb_typeof(before_event) = 'object'
      AND jsonb_typeof(after_event) = 'object'
      AND before_event ->> 'id' = schedule_event_id
      AND after_event ->> 'id' = schedule_event_id
      AND before_event ->> 'status' = 'cancelled'
      AND jsonb_typeof(before_event -> 'cancellation') = 'object'
      AND after_event ->> 'status' = 'planned'
      AND NOT (after_event ? 'cancellation')
      AND before_event IS DISTINCT FROM after_event
    )
  ) NOT VALID;
ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  VALIDATE CONSTRAINT amora_shared_schedule_receipt_delta_check;

CREATE OR REPLACE FUNCTION public.amora_shared_action_policy(
  p_tool_name text,
  p_tool_input jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_tool_name IN (
      'create_booking',
      'cancel_booking',
      'delete_category',
      'reset_category',
      'delete_schedule_event',
      'update_amora_action'
    ) THEN 'blocked'
    WHEN jsonb_typeof(p_tool_input) IS DISTINCT FROM 'object' THEN 'blocked'
    WHEN p_tool_name IN (
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan',
      'cancel_schedule_event',
      'restore_schedule_event'
    ) THEN 'couple'
    WHEN p_tool_name IN ('update_category_budget', 'add_custom_category')
      AND p_tool_input ? 'budget'
      THEN 'couple'
    WHEN p_tool_name = 'add_schedule_event'
      AND p_tool_input ->> 'schedule_scope' = 'confirmed_fact'
      THEN 'single'
    WHEN p_tool_name IN ('add_schedule_event', 'update_schedule_event')
      THEN 'couple'
    WHEN p_tool_name IN (
      'update_task_status',
      'update_category_budget',
      'add_custom_category',
      'toggle_checklist_item',
      'add_amora_action',
      'log_wedding_event'
    ) THEN 'single'
    ELSE 'blocked'
  END;
$function$;

REVOKE ALL ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  TO service_role;

-- Keep the existing immutable execution fence verbatim, extending only the
-- set of journey mutations that must prove an r -> r+1 receipt. Without this
-- additive branch the older fence would reject a valid cancel/restore after
-- its exact journey write and roll the whole transaction back.
CREATE OR REPLACE FUNCTION public.enforce_amora_shared_action_execution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_claim public.amora_chat_request_claims%ROWTYPE;
  v_source_message_id uuid;
  v_context jsonb;
  v_current_journey_revision bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.couple_id IS DISTINCT FROM OLD.couple_id
    OR NEW.request_key IS DISTINCT FROM OLD.request_key
    OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
    OR NEW.tool_name IS DISTINCT FROM OLD.tool_name
    OR NEW.input_digest IS DISTINCT FROM OLD.input_digest
    OR NEW.pending_action_id IS DISTINCT FROM OLD.pending_action_id
    OR NEW.pending_action_journey_revision
      IS DISTINCT FROM OLD.pending_action_journey_revision
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NOT (
       OLD.status IS DISTINCT FROM 'completed'
       AND NEW.status = 'completed'
       AND jsonb_typeof(NEW.result -> 'success') = 'boolean'
       AND (NEW.result ->> 'success')::boolean
     ) THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.pending_action_id IS NULL
     OR (
       TG_OP = 'INSERT'
       AND NEW.status IS DISTINCT FROM 'processing'
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_NOT_AUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim.*
    INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = NEW.couple_id
    AND claim.request_key = NEW.request_key
    AND claim.status = 'processing'
    AND claim.visibility = 'shared'
    AND claim.user_message_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_CLAIM_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT prior.id
    INTO v_source_message_id
  FROM (
    SELECT message.id,
           lag(message.id) OVER (
             ORDER BY message.created_at, message.id
           ) AS prior_id
    FROM public.chat_messages AS message
    WHERE message.couple_id = NEW.couple_id
      AND message.visibility = 'shared'
      AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ) AS ordered
  JOIN public.chat_messages AS prior ON prior.id = ordered.prior_id
  WHERE ordered.id = v_claim.user_message_id
    AND prior.metadata #>> '{pending_amora_action,actionId}'
      = NEW.pending_action_id::text;

  IF v_source_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  v_context := public.authorize_amora_shared_action_execution(
    NEW.pending_action_id,
    NEW.couple_id,
    v_source_message_id,
    v_claim.user_message_id,
    v_claim.user_id
  );

  IF v_context ->> 'tool' IS DISTINCT FROM NEW.tool_name
     OR v_context ->> 'inputDigest' IS DISTINCT FROM NEW.input_digest
     OR v_context ->> 'operationKey' IS DISTINCT FROM NEW.operation_key THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT journey.state_revision
      INTO v_current_journey_revision
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = NEW.couple_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.tool_name IN (
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan',
      'update_category_budget',
      'add_custom_category',
      'update_task_status',
      'add_schedule_event',
      'update_schedule_event',
      'cancel_schedule_event',
      'restore_schedule_event',
      'toggle_checklist_item',
      'log_wedding_event'
    ) THEN
      IF v_current_journey_revision IS DISTINCT FROM
           NEW.pending_action_journey_revision + 1
         OR NOT EXISTS (
           SELECT 1
           FROM public.amora_shared_action_journey_mutation_receipts AS receipt
           WHERE receipt.couple_id = NEW.couple_id
             AND receipt.request_key = NEW.request_key
             AND receipt.operation_key = NEW.operation_key
             AND receipt.action_id = NEW.pending_action_id
             AND receipt.source_message_id = v_source_message_id
             AND receipt.confirmation_message_id =
               v_claim.user_message_id
             AND receipt.expected_revision =
               NEW.pending_action_journey_revision
             AND receipt.applied_revision = v_current_journey_revision
         ) THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
          USING ERRCODE = '55000';
      END IF;
    ELSIF NEW.tool_name = 'add_amora_action' THEN
      IF v_current_journey_revision IS DISTINCT FROM
           NEW.pending_action_journey_revision
         OR EXISTS (
           SELECT 1
           FROM public.amora_shared_action_journey_mutation_receipts AS receipt
           WHERE receipt.couple_id = NEW.couple_id
             AND receipt.request_key = NEW.request_key
             AND receipt.operation_key = NEW.operation_key
         ) THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_BLOCKED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.pending_action_journey_revision :=
      (v_context ->> 'journeyRevision')::bigint;
  ELSIF NEW.pending_action_journey_revision IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION
  public.capture_amora_shared_schedule_cancel_restore_delta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_guard_couple text := NULLIF(current_setting(
    'hanbang.amora_shared_action_couple_id', true
  ), '');
  v_guard_request text := NULLIF(current_setting(
    'hanbang.amora_shared_action_request_key', true
  ), '');
  v_guard_operation text := NULLIF(current_setting(
    'hanbang.amora_shared_action_operation_key', true
  ), '');
  v_guard_action text := NULLIF(current_setting(
    'hanbang.amora_shared_action_action_id', true
  ), '');
  v_guard_expected text := NULLIF(current_setting(
    'hanbang.amora_shared_action_expected_revision', true
  ), '');
  v_guard_applied text := NULLIF(current_setting(
    'hanbang.amora_shared_action_applied_revision', true
  ), '');
  v_tool_name text;
  v_approved_input jsonb;
  v_actor_id uuid;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_delta jsonb;
  v_expected_kind text;
  v_reason text;
  v_rows integer;
BEGIN
  IF v_guard_couple IS NULL
     AND v_guard_request IS NULL
     AND v_guard_operation IS NULL
     AND v_guard_action IS NULL
     AND v_guard_expected IS NULL
     AND v_guard_applied IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_guard_couple IS NULL
     OR v_guard_request IS NULL
     OR v_guard_operation IS NULL
     OR v_guard_action IS NULL
     OR v_guard_expected IS NULL
     OR v_guard_applied IS NULL
     OR v_guard_couple !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_guard_action !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_guard_operation !~ '^[a-f0-9]{64}$'
     OR char_length(v_guard_request) NOT BETWEEN 1 AND 160
     OR v_guard_expected !~ '^(0|[1-9][0-9]{0,15})$'
     OR v_guard_applied !~ '^(0|[1-9][0-9]{0,15})$'
     OR OLD.couple_id::text IS DISTINCT FROM v_guard_couple
     OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
     OR OLD.state_revision IS DISTINCT FROM v_guard_expected::bigint
     OR NEW.state_revision IS DISTINCT FROM v_guard_applied::bigint
     OR NEW.state_revision IS DISTINCT FROM OLD.state_revision + 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_DELTA_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT execution.tool_name,
         source.metadata #> '{pending_amora_action,input}',
         request.user_id,
         couple.bride_id,
         couple.groom_id
    INTO v_tool_name,
         v_approved_input,
         v_actor_id,
         v_raw_bride_id,
         v_raw_groom_id
  FROM public.amora_tool_executions AS execution
  JOIN public.amora_chat_request_claims AS request
    ON request.couple_id = execution.couple_id
   AND request.request_key = execution.request_key
   AND request.status = 'processing'
   AND request.visibility = 'shared'
  JOIN public.amora_shared_action_journey_mutation_receipts AS receipt
    ON receipt.couple_id = execution.couple_id
   AND receipt.request_key = execution.request_key
   AND receipt.operation_key = execution.operation_key
   AND receipt.action_id = execution.pending_action_id
   AND receipt.expected_revision = OLD.state_revision
   AND receipt.applied_revision = NEW.state_revision
  JOIN public.chat_messages AS source
    ON source.id = receipt.source_message_id
   AND source.couple_id = receipt.couple_id
  JOIN public.chat_messages AS confirmation
    ON confirmation.id = receipt.confirmation_message_id
   AND confirmation.couple_id = receipt.couple_id
   AND confirmation.sender_id = request.user_id
   AND confirmation.sender_type IN ('bride', 'groom')
   AND confirmation.role = 'user'
   AND confirmation.visibility = 'shared'
   AND confirmation.metadata ->> 'confirmed_amora_action_id'
       = receipt.action_id::text
  JOIN public.couples AS couple
    ON couple.id = execution.couple_id
  WHERE execution.couple_id = OLD.couple_id
    AND execution.request_key = v_guard_request
    AND execution.operation_key = v_guard_operation
    AND execution.pending_action_id = v_guard_action::uuid
    AND execution.pending_action_journey_revision = OLD.state_revision
    AND execution.status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_DELTA_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;
  IF v_tool_name = 'delete_schedule_event' THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_HARD_DELETE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF v_tool_name NOT IN (
    'cancel_schedule_event', 'restore_schedule_event'
  ) THEN
    RETURN NEW;
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, OLD.couple_id)
      THEN v_raw_bride_id ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, OLD.couple_id)
      THEN v_raw_groom_id ELSE NULL
  END;
  IF v_actor_id IS NULL
     OR (
       v_actor_id IS DISTINCT FROM v_bride_id
       AND v_actor_id IS DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_ACTOR_INVALID'
      USING ERRCODE = '42501';
  END IF;

  v_delta := public.amora_manual_schedule_delta(
    OLD.progress,
    NEW.progress,
    v_bride_id,
    v_groom_id
  );
  v_expected_kind := CASE v_tool_name
    WHEN 'cancel_schedule_event' THEN 'cancel'
    ELSE 'restore'
  END;
  IF v_delta ->> 'mutationKind' IS DISTINCT FROM v_expected_kind
     OR jsonb_typeof(v_approved_input) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_approved_input -> 'event_id')
        IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_approved_input -> 'expected_title')
        IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_approved_input -> 'expected_date')
        IS DISTINCT FROM 'string'
     OR char_length(btrim(v_approved_input ->> 'event_id'))
        NOT BETWEEN 1 AND 200
     OR char_length(v_approved_input ->> 'expected_title')
        NOT BETWEEN 1 AND 500
     OR v_approved_input ->> 'expected_title'
        IS DISTINCT FROM btrim(v_approved_input ->> 'expected_title')
     OR public.couple_plan_change_has_unsafe_display_text(
          v_approved_input ->> 'expected_title'
        )
     OR v_approved_input ->> 'expected_date'
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR v_approved_input ->> 'event_id'
        IS DISTINCT FROM v_delta ->> 'eventId'
     OR v_approved_input ->> 'expected_title'
        IS DISTINCT FROM v_delta #>> '{before,title}'
     OR v_approved_input ->> 'expected_date'
        IS DISTINCT FROM v_delta #>> '{before,date}' THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_DELTA_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF v_expected_kind = 'cancel' THEN
    IF v_approved_input - ARRAY[
         'event_id', 'expected_title', 'expected_date', 'reason'
       ]::text[] <> '{}'::jsonb
       OR (
         v_approved_input ? 'reason'
         AND (
           jsonb_typeof(v_approved_input -> 'reason')
             IS DISTINCT FROM 'string'
           OR char_length(btrim(v_approved_input ->> 'reason'))
             NOT BETWEEN 1 AND 500
           OR public.couple_plan_change_has_unsafe_display_text(
             v_approved_input ->> 'reason'
           )
         )
       )
       OR v_delta #>> '{after,cancellation,cancelledByProfileId}'
          IS DISTINCT FROM v_actor_id::text THEN
      RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_CANCEL_DELTA_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_reason := NULLIF(btrim(v_approved_input ->> 'reason'), '');
    IF (
         v_reason IS NULL
         AND v_delta #> '{after,cancellation}' ? 'reason'
       ) OR (
         v_reason IS NOT NULL
         AND v_delta #>> '{after,cancellation,reason}'
             IS DISTINCT FROM v_reason
       ) THEN
      RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_CANCEL_DELTA_INVALID'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_approved_input - ARRAY[
    'event_id', 'expected_title', 'expected_date'
  ]::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_RESTORE_DELTA_INVALID'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_shared_action_journey_mutation_receipts
  SET mutation_kind = v_expected_kind,
      schedule_scope = NULL,
      schedule_event_id = v_delta ->> 'eventId',
      before_event = v_delta -> 'before',
      after_event = v_delta -> 'after'
  WHERE couple_id = OLD.couple_id
    AND request_key = v_guard_request
    AND operation_key = v_guard_operation
    AND action_id = v_guard_action::uuid
    AND expected_revision = OLD.state_revision
    AND applied_revision = NEW.state_revision
    AND mutation_kind IS NULL
    AND schedule_scope IS NULL
    AND schedule_event_id IS NULL
    AND before_event IS NULL
    AND after_event IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS
  trg_capture_amora_shared_schedule_cancel_restore_delta
  ON public.wedding_journeys;
CREATE TRIGGER trg_capture_amora_shared_schedule_cancel_restore_delta
  BEFORE UPDATE ON public.wedding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION
    public.capture_amora_shared_schedule_cancel_restore_delta();

ALTER TABLE public.couple_plan_change_requests
  ADD COLUMN IF NOT EXISTS schedule_mutation_kind text,
  ADD COLUMN IF NOT EXISTS schedule_event_id text,
  ADD COLUMN IF NOT EXISTS schedule_before_event jsonb,
  ADD COLUMN IF NOT EXISTS schedule_after_event jsonb;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'couple_plan_change_schedule_receipt_check'
      AND conrelid = 'public.couple_plan_change_requests'::regclass
  ) THEN
    ALTER TABLE public.couple_plan_change_requests
      ADD CONSTRAINT couple_plan_change_schedule_receipt_check CHECK (
        (
          schedule_mutation_kind IS NULL
          AND schedule_event_id IS NULL
          AND schedule_before_event IS NULL
          AND schedule_after_event IS NULL
        )
        OR (
          schedule_mutation_kind = 'add'
          AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
          AND schedule_before_event IS NULL
          AND jsonb_typeof(schedule_after_event) = 'object'
          AND schedule_after_event ->> 'id' = schedule_event_id
        )
        OR (
          schedule_mutation_kind IN ('update', 'cancel', 'restore')
          AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
          AND jsonb_typeof(schedule_before_event) = 'object'
          AND jsonb_typeof(schedule_after_event) = 'object'
          AND schedule_before_event ->> 'id' = schedule_event_id
          AND schedule_after_event ->> 'id' = schedule_event_id
          AND schedule_before_event IS DISTINCT FROM schedule_after_event
        )
      ) NOT VALID;
  END IF;
END
$block$;

ALTER TABLE public.couple_plan_change_requests
  VALIDATE CONSTRAINT couple_plan_change_schedule_receipt_check;

-- Audit clocks are not part of the user's scheduling intent. This digest is
-- used only to recover the same immutable server-canonical request after a
-- retry; the stored change_digest continues to bind every exact byte that is
-- approved and eventually applied.
CREATE OR REPLACE FUNCTION public.amora_manual_schedule_intent_digest(
  p_changes jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_event jsonb;
  v_events jsonb := '[]'::jsonb;
  v_intent jsonb;
BEGIN
  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
     OR p_changes - ARRAY[
       'progress_patch', 'progress_remove_keys'
     ]::text[] <> '{}'::jsonb
     OR jsonb_typeof(p_changes -> 'progress_patch')
        IS DISTINCT FROM 'object'
     OR (p_changes -> 'progress_patch') - '__events' <> '{}'::jsonb
     OR jsonb_typeof(p_changes #> '{progress_patch,__events}')
        IS DISTINCT FROM 'array'
     OR (
       p_changes ? 'progress_remove_keys'
       AND p_changes -> 'progress_remove_keys' <> '[]'::jsonb
     ) THEN
    RETURN NULL;
  END IF;

  FOR v_event IN
    SELECT item.value
    FROM jsonb_array_elements(
      p_changes #> '{progress_patch,__events}'
    ) AS item(value)
  LOOP
    -- Audit clocks are deliberately excluded from intent. Legacy unchanged
    -- events may predate those fields; requiring them here would return NULL
    -- and route the whole schedule write around the canonical-clock wrapper.
    -- The canonicalizer and delta validator below still reject any unsafe
    -- changed event before a request can be created.
    IF jsonb_typeof(v_event) IS DISTINCT FROM 'object' THEN
      RETURN NULL;
    END IF;
    v_event := v_event - ARRAY['createdAt', 'updatedAt']::text[];
    IF jsonb_typeof(v_event -> 'cancellation') = 'object' THEN
      v_event := jsonb_set(
        v_event,
        '{cancellation}',
        (v_event -> 'cancellation') - 'cancelledAt',
        false
      );
    END IF;
    v_events := v_events || jsonb_build_array(v_event);
  END LOOP;

  v_intent := jsonb_set(
    p_changes,
    '{progress_patch,__events}',
    v_events,
    false
  );
  RETURN encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'scheduleIntentVersion', 1,
          'changes', v_intent
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- Replace every client-provided schedule audit clock with one timestamp from
-- the database. The canonical event is produced before its digest, summary,
-- acceptance receipt, and application row are created, so approval and apply
-- can never refer to different proposed states.
CREATE OR REPLACE FUNCTION public.amora_manual_schedule_canonical_changes(
  p_old_progress jsonb,
  p_changes jsonb,
  p_bride_id uuid,
  p_groom_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old_events jsonb;
  v_new_events jsonb;
  v_new_progress jsonb;
  v_old_count integer;
  v_new_count integer;
  v_index integer;
  v_changed_index integer := -1;
  v_changed_count integer := 0;
  v_before jsonb;
  v_after jsonb;
  v_before_status text;
  v_after_status text;
  v_before_updated_at timestamptz;
  v_canonical_at timestamptz := date_trunc(
    'milliseconds', clock_timestamp()
  );
  v_canonical_text text;
  v_result jsonb := p_changes;
BEGIN
  IF jsonb_typeof(COALESCE(p_old_progress, '{}'::jsonb))
       IS DISTINCT FROM 'object'
     OR p_changes IS NULL
     OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
     OR p_changes - ARRAY[
       'progress_patch', 'progress_remove_keys'
     ]::text[] <> '{}'::jsonb
     OR jsonb_typeof(p_changes -> 'progress_patch')
        IS DISTINCT FROM 'object'
     OR (p_changes -> 'progress_patch') - '__events' <> '{}'::jsonb
     OR jsonb_typeof(p_changes #> '{progress_patch,__events}')
        IS DISTINCT FROM 'array'
     OR (
       p_changes ? 'progress_remove_keys'
       AND p_changes -> 'progress_remove_keys' <> '[]'::jsonb
     ) THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_CANONICAL_INPUT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_old_progress, '{}'::jsonb) ? '__events' THEN
    IF jsonb_typeof(p_old_progress -> '__events') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_EVENT_ARRAY'
        USING ERRCODE = '22023';
    END IF;
    v_old_events := p_old_progress -> '__events';
  ELSE
    v_old_events := '[]'::jsonb;
  END IF;
  v_new_events := p_changes #> '{progress_patch,__events}';
  v_old_count := jsonb_array_length(v_old_events);
  v_new_count := jsonb_array_length(v_new_events);

  IF v_new_count = v_old_count - 1 THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_HARD_DELETE_DENIED'
      USING ERRCODE = '42501';
  ELSIF v_new_count = v_old_count + 1 THEN
    IF v_old_count > 0 THEN
      FOR v_index IN 0..v_old_count - 1 LOOP
        IF v_old_events -> v_index IS DISTINCT FROM v_new_events -> v_index THEN
          RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_ADD_NOT_APPEND_ONLY'
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    v_changed_index := v_old_count;
    v_after := v_new_events -> v_changed_index;
    IF jsonb_typeof(v_after) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_ADD'
        USING ERRCODE = '22023';
    END IF;
    v_canonical_text := to_char(
      v_canonical_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    v_after := v_after || jsonb_build_object(
      'createdAt', v_canonical_text,
      'updatedAt', v_canonical_text
    );
  ELSIF v_new_count = v_old_count AND v_old_count > 0 THEN
    FOR v_index IN 0..v_old_count - 1 LOOP
      IF v_old_events -> v_index ->> 'id' IS DISTINCT FROM
         v_new_events -> v_index ->> 'id' THEN
        RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_ORDER_OR_ID_CHANGED'
          USING ERRCODE = '22023';
      END IF;
      IF v_old_events -> v_index IS DISTINCT FROM v_new_events -> v_index THEN
        v_changed_count := v_changed_count + 1;
        v_changed_index := v_index;
        v_before := v_old_events -> v_index;
        v_after := v_new_events -> v_index;
      END IF;
    END LOOP;
    IF v_changed_count <> 1
       OR NOT public.amora_manual_schedule_event_is_valid(
         v_before, p_bride_id, p_groom_id
       )
       OR jsonb_typeof(v_after) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_INVALID_UPDATE'
        USING ERRCODE = '22023';
    END IF;
    v_before_updated_at := (v_before ->> 'updatedAt')::timestamptz;
    IF v_before_updated_at > v_canonical_at + interval '5 minutes' THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_STORED_CLOCK_UNSAFE'
        USING ERRCODE = '22023';
    END IF;
    v_canonical_at := GREATEST(
      v_canonical_at,
      date_trunc('milliseconds', v_before_updated_at)
        + interval '1 millisecond'
    );
    v_canonical_text := to_char(
      v_canonical_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    v_after := jsonb_set(
      v_after,
      '{updatedAt}',
      to_jsonb(v_canonical_text),
      true
    );
    v_before_status := COALESCE(v_before ->> 'status', 'planned');
    v_after_status := COALESCE(v_after ->> 'status', 'planned');
    IF v_before_status <> 'cancelled'
       AND v_after_status = 'cancelled'
       AND jsonb_typeof(v_after -> 'cancellation') = 'object' THEN
      v_after := jsonb_set(
        v_after,
        '{cancellation,cancelledAt}',
        to_jsonb(v_canonical_text),
        true
      );
    END IF;
  ELSE
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_UNSUPPORTED_DELTA'
      USING ERRCODE = '22023';
  END IF;

  v_new_events := jsonb_set(
    v_new_events,
    ARRAY[v_changed_index::text],
    v_after,
    false
  );
  v_result := jsonb_set(
    v_result,
    '{progress_patch,__events}',
    v_new_events,
    false
  );
  v_new_progress := COALESCE(p_old_progress, '{}'::jsonb)
    || (v_result -> 'progress_patch');
  PERFORM public.amora_manual_schedule_delta(
    p_old_progress,
    v_new_progress,
    p_bride_id,
    p_groom_id
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_amora_manual_plan_change_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_journey public.wedding_journeys%ROWTYPE;
  v_couple public.couples%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_remove_keys text[];
  v_next_progress jsonb;
  v_delta jsonb;
  v_expected_required smallint;
  v_expected_fingerprint text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
       OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
       OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
       OR NEW.changes IS DISTINCT FROM OLD.changes
       OR NEW.change_digest IS DISTINCT FROM OLD.change_digest
       OR NEW.roster_fingerprint IS DISTINCT FROM OLD.roster_fingerprint
       OR NEW.surface_href IS DISTINCT FROM OLD.surface_href
       OR NEW.summary IS DISTINCT FROM OLD.summary
       OR NEW.is_high_impact IS DISTINCT FROM OLD.is_high_impact
       OR NEW.required_count IS DISTINCT FROM OLD.required_count
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.actor_accepted_at IS DISTINCT FROM OLD.actor_accepted_at
       OR NEW.schedule_mutation_kind IS DISTINCT FROM
          OLD.schedule_mutation_kind
       OR NEW.schedule_event_id IS DISTINCT FROM OLD.schedule_event_id
       OR NEW.schedule_before_event IS DISTINCT FROM
          OLD.schedule_before_event
       OR NEW.schedule_after_event IS DISTINCT FROM OLD.schedule_after_event THEN
      RAISE EXCEPTION 'AMORA_MANUAL_PLAN_REQUEST_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.schedule_mutation_kind IS NOT NULL
     OR NEW.schedule_event_id IS NOT NULL
     OR NEW.schedule_before_event IS NOT NULL
     OR NEW.schedule_after_event IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_RECEIPT_SERVER_OWNED'
      USING ERRCODE = '42501';
  END IF;

  SELECT journey.* INTO v_journey
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = NEW.couple_id;
  SELECT couple.* INTO v_couple
  FROM public.couples AS couple
  WHERE couple.id = NEW.couple_id;
  IF v_journey.id IS NULL OR v_couple.id IS NULL THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_SCOPE_INVALID'
      USING ERRCODE = '55000';
  END IF;
  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_couple.bride_id, NEW.couple_id)
      THEN v_couple.bride_id ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_couple.groom_id, NEW.couple_id)
      THEN v_couple.groom_id ELSE NULL
  END;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(NEW.changes -> 'progress_remove_keys', '[]'::jsonb)
  ) AS item(key);
  v_next_progress := (
    COALESCE(v_journey.progress, '{}'::jsonb) - v_remove_keys
  ) || COALESCE(NEW.changes -> 'progress_patch', '{}'::jsonb);

  IF (COALESCE(v_journey.progress, '{}'::jsonb) -> '__events')
       IS DISTINCT FROM
     (COALESCE(v_next_progress, '{}'::jsonb) -> '__events') THEN
    v_delta := public.amora_manual_schedule_delta(
      v_journey.progress, v_next_progress, v_bride_id, v_groom_id
    );
    IF v_delta ->> 'mutationKind' = 'cancel'
       AND (
         v_delta #>> '{after,cancellation,cancelledByProfileId}'
       )::uuid IS DISTINCT FROM NEW.actor_user_id THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_CANCEL_ACTOR_MISMATCH'
        USING ERRCODE = '42501';
    END IF;
    v_expected_required := CASE
      WHEN v_bride_id IS NOT NULL
       AND v_groom_id IS NOT NULL
       AND v_bride_id <> v_groom_id THEN 2
      ELSE 1
    END;
    v_expected_fingerprint := md5(
      COALESCE(v_bride_id::text, '-') || ':' ||
      COALESCE(v_groom_id::text, '-')
    );
    IF NEW.is_high_impact IS DISTINCT FROM true
       OR NEW.actor_user_id IS DISTINCT FROM v_bride_id
          AND NEW.actor_user_id IS DISTINCT FROM v_groom_id
       OR NEW.required_count IS DISTINCT FROM v_expected_required
       OR NEW.roster_fingerprint IS DISTINCT FROM v_expected_fingerprint
       OR NEW.change_digest IS DISTINCT FROM
          public.couple_plan_change_digest(NEW.changes)
       OR NEW.changes - ARRAY[
         'progress_patch', 'progress_remove_keys'
       ]::text[] <> '{}'::jsonb
       OR jsonb_typeof(NEW.changes -> 'progress_patch')
          IS DISTINCT FROM 'object'
       OR (NEW.changes -> 'progress_patch') - '__events' <> '{}'::jsonb
       OR (
         NEW.changes ? 'progress_remove_keys'
         AND NEW.changes -> 'progress_remove_keys' <> '[]'::jsonb
       ) THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_APPROVAL_REQUIRED'
        USING ERRCODE = '42501';
    END IF;
    NEW.summary := v_delta ->> 'summary';
    NEW.schedule_mutation_kind := v_delta ->> 'mutationKind';
    NEW.schedule_event_id := v_delta ->> 'eventId';
    NEW.schedule_before_event := NULLIF(v_delta -> 'before', 'null'::jsonb);
    NEW.schedule_after_event := v_delta -> 'after';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_prepare_amora_manual_plan_change_request
  ON public.couple_plan_change_requests;
CREATE TRIGGER trg_00_prepare_amora_manual_plan_change_request
  BEFORE INSERT OR UPDATE ON public.couple_plan_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_amora_manual_plan_change_request();

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
  v_roster_fingerprint text;
  v_changes jsonb;
  v_canonical_changes jsonb;
  v_intent_digest text;
  v_journey public.wedding_journeys%ROWTYPE;
  v_existing public.couple_plan_change_requests%ROWTYPE;
BEGIN
  -- Preserve the original public contract and its exact error taxonomy for
  -- non-service callers and malformed top-level requests.
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_revision NOT BETWEEN 0 AND 9007199254740990
     OR p_surface NOT IN ('/schedule', '/budget', '/dashboard')
     OR p_summary IS NULL
     OR char_length(p_summary) NOT BETWEEN 1 AND 240
     OR p_summary IS DISTINCT FROM btrim(p_summary)
     OR public.couple_plan_change_has_unsafe_display_text(p_summary) THEN
    RETURN public.submit_couple_plan_change_before_manual_schedule_clock(
      p_couple_id,
      p_actor_user_id,
      p_expected_revision,
      p_changes,
      p_surface,
      p_summary
    );
  END IF;

  v_changes := public.normalize_couple_plan_changes(p_changes);
  v_intent_digest := public.amora_manual_schedule_intent_digest(v_changes);
  IF v_intent_digest IS NULL THEN
    RETURN public.submit_couple_plan_change_before_manual_schedule_clock(
      p_couple_id,
      p_actor_user_id,
      p_expected_revision,
      v_changes,
      p_surface,
      p_summary
    );
  END IF;

  -- Match the established global lock order used by the reviewed base RPC.
  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.submit_couple_plan_change_before_manual_schedule_clock(
      p_couple_id,
      p_actor_user_id,
      p_expected_revision,
      v_changes,
      p_surface,
      p_summary
    );
  END IF;
  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id ELSE NULL
  END;
  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RETURN public.submit_couple_plan_change_before_manual_schedule_clock(
      p_couple_id,
      p_actor_user_id,
      p_expected_revision,
      v_changes,
      p_surface,
      p_summary
    );
  END IF;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-') || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT journey.* INTO v_journey
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.submit_couple_plan_change_before_manual_schedule_clock(
      p_couple_id,
      p_actor_user_id,
      p_expected_revision,
      v_changes,
      p_surface,
      p_summary
    );
  END IF;

  -- Lost-response recovery intentionally ignores a changed partner roster,
  -- just like the base RPC: the still-current actor receives the immutable
  -- receipt that already reached the database, never a second mutation.
  SELECT request.* INTO v_existing
  FROM public.couple_plan_change_requests AS request
  WHERE request.couple_id = p_couple_id
    AND request.actor_user_id = p_actor_user_id
    AND request.base_revision = p_expected_revision
    AND request.status = 'applied'
    AND request.schedule_mutation_kind IS NOT NULL
    AND public.amora_manual_schedule_intent_digest(request.changes)
        = v_intent_digest
  ORDER BY request.applied_at DESC, request.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN public.couple_plan_change_result(v_existing.id);
  END IF;

  -- Pending and rejected retries remain roster-scoped. An expired or stale
  -- pending request is deliberately left to the base RPC, which atomically
  -- marks it stale before inserting a fresh canonical proposal.
  SELECT request.* INTO v_existing
  FROM public.couple_plan_change_requests AS request
  WHERE request.couple_id = p_couple_id
    AND request.actor_user_id = p_actor_user_id
    AND request.base_revision = p_expected_revision
    AND request.status <> 'stale'
    AND request.roster_fingerprint = v_roster_fingerprint
    AND request.schedule_mutation_kind IS NOT NULL
    AND public.amora_manual_schedule_intent_digest(request.changes)
        = v_intent_digest
  ORDER BY request.created_at DESC, request.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND AND (
    v_existing.status <> 'pending'
    OR (
      v_existing.expires_at > clock_timestamp()
      AND v_existing.base_revision = v_journey.state_revision
    )
  ) THEN
    RETURN public.couple_plan_change_result(v_existing.id);
  END IF;

  v_canonical_changes := public.amora_manual_schedule_canonical_changes(
    v_journey.progress,
    v_changes,
    v_bride_id,
    v_groom_id
  );
  RETURN public.submit_couple_plan_change_before_manual_schedule_clock(
    p_couple_id,
    p_actor_user_id,
    p_expected_revision,
    v_canonical_changes,
    p_surface,
    p_summary
  );
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS
  decision_nodes_manual_plan_change_request_unique
  ON public.decision_nodes(source_ref_id)
  WHERE source IN ('manual', 'schedule')
    AND metadata ->> 'origin' = 'couple_plan_change_request';

-- Requests applied before this trigger existed still represent confirmed user
-- decisions. Backfill only facts already present in the immutable request and
-- acceptance ledger. In particular, never invent a historical schedule
-- before/after pair that the old schema did not retain.
INSERT INTO public.decision_nodes(
  id,
  couple_id,
  category,
  decision_type,
  title,
  chosen_value,
  options_considered,
  reasoning,
  confidence,
  decided_at,
  source,
  source_ref_id,
  source_actor_role,
  user_confirmed_at,
  metadata,
  visibility,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  request.couple_id,
  CASE request.surface_href
    WHEN '/schedule' THEN 'schedule'
    WHEN '/budget' THEN 'budget'
    ELSE 'plan'
  END,
  CASE request.surface_href
    WHEN '/schedule' THEN 'scheduled'
    ELSE 'decided'
  END,
  request.summary,
  jsonb_build_object(
    'schemaVersion', 1,
    'requestId', request.id,
    'changeDigest', request.change_digest,
    'expectedRevision', request.base_revision,
    'appliedRevision', request.applied_revision,
    'requiredCount', request.required_count,
    'acceptances', acceptance_receipt.acceptances,
    'mutationKind', NULL::text,
    'eventId', NULL::text,
    'before', NULL::jsonb,
    'after', NULL::jsonb,
    'changes', request.changes,
    'legacyReceiptOnly', true
  ),
  '[]'::jsonb,
  CASE request.surface_href
    WHEN '/schedule' THEN
      '기존 수동 일정 변경 영수증을 이관함. 당시 스키마에 정확한 이전·이후 일정은 보관되지 않았음'
    ELSE '기존 수동 계획 변경 영수증을 이관함'
  END,
  1.00,
  request.applied_at,
  CASE request.surface_href WHEN '/schedule' THEN 'schedule' ELSE 'manual' END,
  request.id,
  CASE
    WHEN request.actor_user_id = couple.bride_id THEN 'bride'
    WHEN request.actor_user_id = couple.groom_id THEN 'groom'
    ELSE NULL
  END,
  request.actor_accepted_at,
  jsonb_build_object(
    'origin', 'couple_plan_change_request',
    'requestId', request.id,
    'changeDigest', request.change_digest,
    'rosterFingerprint', request.roster_fingerprint,
    'expectedRevision', request.base_revision,
    'appliedRevision', request.applied_revision,
    'requiredCount', request.required_count,
    'acceptances', acceptance_receipt.acceptances,
    'mutationKind', NULL::text,
    'eventId', NULL::text,
    'before', NULL::jsonb,
    'after', NULL::jsonb,
    'surfaceHref', request.surface_href,
    'legacyReceiptOnly', true,
    'exactScheduleDeltaUnavailable', request.surface_href = '/schedule'
  ),
  'shared',
  request.applied_at,
  request.applied_at
FROM public.couple_plan_change_requests AS request
JOIN public.couples AS couple ON couple.id = request.couple_id
CROSS JOIN LATERAL (
  SELECT
    count(*)::integer AS acceptance_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'userId', acceptance.user_id,
          'acceptedAt', acceptance.accepted_at
        ) ORDER BY acceptance.user_id
      ),
      '[]'::jsonb
    ) AS acceptances
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = request.id
    AND acceptance.couple_id = request.couple_id
    AND acceptance.change_digest = request.change_digest
    AND acceptance.roster_fingerprint = request.roster_fingerprint
) AS acceptance_receipt
WHERE request.status = 'applied'
  AND request.applied_at IS NOT NULL
  AND request.applied_revision = request.base_revision + 1
  AND acceptance_receipt.acceptance_count = request.required_count
  AND NOT EXISTS (
    SELECT 1
    FROM public.decision_nodes AS decision
    WHERE decision.source_ref_id = request.id
      AND decision.source IN ('manual', 'schedule')
      AND decision.metadata ->> 'origin' = 'couple_plan_change_request'
  );

CREATE OR REPLACE FUNCTION public.record_amora_manual_plan_change_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_couple public.couples%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_actor_role text;
  v_acceptance_count integer;
  v_acceptances jsonb;
  v_source text;
  v_decision_type text;
  v_category text;
  v_reasoning text;
  v_chosen_value jsonb;
  v_metadata jsonb;
  v_rows integer;
BEGIN
  IF OLD.status IS DISTINCT FROM 'applying'
     OR NEW.status IS DISTINCT FROM 'applied' THEN
    RETURN NEW;
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.applied_at IS NULL
     OR NEW.applied_by_user_id IS NULL
     OR NEW.applied_revision IS DISTINCT FROM NEW.base_revision + 1 THEN
    RAISE EXCEPTION 'AMORA_MANUAL_DECISION_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT couple.* INTO v_couple
  FROM public.couples AS couple
  WHERE couple.id = NEW.couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MANUAL_DECISION_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;
  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_couple.bride_id, NEW.couple_id)
      THEN v_couple.bride_id ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_couple.groom_id, NEW.couple_id)
      THEN v_couple.groom_id ELSE NULL
  END;
  v_actor_role := CASE
    WHEN NEW.actor_user_id = v_bride_id THEN 'bride'
    WHEN NEW.actor_user_id = v_groom_id THEN 'groom'
    ELSE NULL
  END;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'AMORA_MANUAL_DECISION_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer,
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'userId', acceptance.user_id,
               'acceptedAt', acceptance.accepted_at
             ) ORDER BY acceptance.user_id
           ),
           '[]'::jsonb
         )
    INTO v_acceptance_count, v_acceptances
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = NEW.id
    AND acceptance.couple_id = NEW.couple_id
    AND acceptance.change_digest = NEW.change_digest
    AND acceptance.roster_fingerprint = NEW.roster_fingerprint
    AND acceptance.user_id IN (v_bride_id, v_groom_id);
  IF v_acceptance_count IS DISTINCT FROM NEW.required_count::integer THEN
    RAISE EXCEPTION 'AMORA_MANUAL_DECISION_ACCEPTANCES_INVALID'
      USING ERRCODE = '55000';
  END IF;

  v_source := CASE NEW.surface_href
    WHEN '/schedule' THEN 'schedule'
    ELSE 'manual'
  END;
  v_decision_type := CASE v_source
    WHEN 'schedule' THEN 'scheduled' ELSE 'decided'
  END;
  v_category := CASE
    WHEN v_source = 'schedule' THEN COALESCE(
      NULLIF(btrim(NEW.schedule_after_event ->> 'categoryKey'), ''),
      'schedule'
    )
    WHEN NEW.surface_href = '/budget' THEN 'budget'
    WHEN NEW.surface_href = '/schedule' THEN 'schedule'
    ELSE 'plan'
  END;
  v_reasoning := CASE NEW.required_count
    WHEN 2 THEN '두 구성원이 확인한 수동 계획 변경'
    ELSE '현재 구성원이 확인한 수동 계획 변경'
  END;
  v_chosen_value := jsonb_build_object(
    'schemaVersion', 1,
    'requestId', NEW.id,
    'changeDigest', NEW.change_digest,
    'expectedRevision', NEW.base_revision,
    'appliedRevision', NEW.applied_revision,
    'requiredCount', NEW.required_count,
    'acceptances', v_acceptances,
    'mutationKind', NEW.schedule_mutation_kind,
    'eventId', NEW.schedule_event_id,
    'before', NEW.schedule_before_event,
    'after', NEW.schedule_after_event,
    'changes', NEW.changes
  );
  v_metadata := jsonb_build_object(
    'origin', 'couple_plan_change_request',
    'requestId', NEW.id,
    'changeDigest', NEW.change_digest,
    'rosterFingerprint', NEW.roster_fingerprint,
    'expectedRevision', NEW.base_revision,
    'appliedRevision', NEW.applied_revision,
    'requiredCount', NEW.required_count,
    'acceptances', v_acceptances,
    'mutationKind', NEW.schedule_mutation_kind,
    'eventId', NEW.schedule_event_id,
    'before', NEW.schedule_before_event,
    'after', NEW.schedule_after_event,
    'surfaceHref', NEW.surface_href,
    'previousStatus', OLD.status
  );

  INSERT INTO public.decision_nodes(
    id,
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    options_considered,
    reasoning,
    confidence,
    decided_at,
    source,
    source_ref_id,
    source_actor_role,
    user_confirmed_at,
    metadata,
    visibility,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.couple_id,
    v_category,
    v_decision_type,
    NEW.summary,
    v_chosen_value,
    '[]'::jsonb,
    v_reasoning,
    1.00,
    NEW.applied_at,
    v_source,
    NEW.id,
    v_actor_role,
    NEW.actor_accepted_at,
    v_metadata,
    'shared',
    NEW.applied_at,
    NEW.applied_at
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_MANUAL_DECISION_INSERT_FAILED'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_record_amora_manual_plan_change_decision
  ON public.couple_plan_change_requests;
CREATE TRIGGER trg_record_amora_manual_plan_change_decision
  AFTER UPDATE OF status ON public.couple_plan_change_requests
  FOR EACH ROW
  WHEN (OLD.status = 'applying' AND NEW.status = 'applied')
  EXECUTE FUNCTION public.record_amora_manual_plan_change_decision();

CREATE OR REPLACE FUNCTION
  public.record_amora_shared_schedule_cancel_restore_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt
    public.amora_shared_action_journey_mutation_receipts%ROWTYPE;
  v_actor_role text;
  v_confirmed_at timestamptz;
  v_decision_node_id uuid := gen_random_uuid();
  v_recorded_at timestamptz := clock_timestamp();
  v_category text;
  v_title text;
  v_value text;
  v_expected_kind text;
  v_rows integer;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM 'completed'
     OR NEW.status IS DISTINCT FROM 'completed'
     OR NEW.tool_name NOT IN (
       'cancel_schedule_event', 'restore_schedule_event'
     )
     OR jsonb_typeof(NEW.result -> 'success') IS DISTINCT FROM 'boolean'
     OR (NEW.result ->> 'success')::boolean IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.pending_action_id IS NULL
     OR NEW.pending_action_journey_revision IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_DECISION_NOT_AUTHORIZED'
      USING ERRCODE = '42501';
  END IF;
  v_expected_kind := CASE NEW.tool_name
    WHEN 'cancel_schedule_event' THEN 'cancel'
    ELSE 'restore'
  END;

  SELECT receipt.*
    INTO v_receipt
  FROM public.amora_shared_action_journey_mutation_receipts AS receipt
  WHERE receipt.couple_id = NEW.couple_id
    AND receipt.request_key = NEW.request_key
    AND receipt.operation_key = NEW.operation_key
    AND receipt.action_id = NEW.pending_action_id
    AND receipt.expected_revision = NEW.pending_action_journey_revision
    AND receipt.applied_revision = NEW.pending_action_journey_revision + 1
    AND receipt.mutation_kind = v_expected_kind
    AND receipt.schedule_event_id IS NOT NULL
    AND receipt.before_event IS NOT NULL
    AND receipt.after_event IS NOT NULL
    AND receipt.decision_node_id IS NULL
    AND receipt.decision_recorded_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
     OR NEW.result ->> 'toolName' IS DISTINCT FROM NEW.tool_name
     OR NEW.result #> '{toolOutput,event}'
        IS DISTINCT FROM v_receipt.after_event
     OR NEW.result #> '{toolOutput,previous_event}'
        IS DISTINCT FROM v_receipt.before_event THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_DECISION_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT confirmation.sender_type, confirmation.created_at
    INTO v_actor_role, v_confirmed_at
  FROM public.chat_messages AS confirmation
  WHERE confirmation.id = v_receipt.confirmation_message_id
    AND confirmation.couple_id = NEW.couple_id
    AND confirmation.sender_id IS NOT NULL
    AND confirmation.sender_type IN ('bride', 'groom')
    AND confirmation.role = 'user'
    AND confirmation.visibility = 'shared'
    AND confirmation.metadata ->> 'confirmed_amora_action_id'
      = NEW.pending_action_id::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_CONFIRMATION_INVALID'
      USING ERRCODE = '55000';
  END IF;

  v_category := COALESCE(
    NULLIF(btrim(v_receipt.after_event ->> 'categoryKey'), ''),
    'schedule'
  );
  v_title := left(
    CASE v_expected_kind
      WHEN 'cancel' THEN '일정 취소 · '
      ELSE '일정 복원 · '
    END || COALESCE(
      NULLIF(btrim(v_receipt.after_event ->> 'title'), ''),
      '일정'
    ),
    500
  );
  v_value := left(
    concat_ws(
      ' · ',
      NULLIF(btrim(v_receipt.after_event ->> 'date'), ''),
      NULLIF(btrim(v_receipt.after_event ->> 'time'), ''),
      NULLIF(btrim(v_receipt.after_event ->> 'title'), '')
    ),
    1000
  );

  INSERT INTO public.decision_nodes(
    id,
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    options_considered,
    reasoning,
    confidence,
    decided_at,
    source,
    source_ref_id,
    source_message_id,
    source_actor_role,
    user_confirmed_at,
    metadata,
    visibility,
    created_at,
    updated_at
  ) VALUES (
    v_decision_node_id,
    NEW.couple_id,
    v_category,
    'scheduled',
    v_title,
    jsonb_build_object(
      'value', v_value,
      'schemaVersion', 1,
      'operation', v_expected_kind,
      'scheduleScope', v_receipt.schedule_scope,
      'eventId', v_receipt.schedule_event_id,
      'before', v_receipt.before_event,
      'after', v_receipt.after_event,
      'expectedRevision', v_receipt.expected_revision,
      'appliedRevision', v_receipt.applied_revision
    ),
    '[]'::jsonb,
    CASE v_expected_kind
      WHEN 'cancel' THEN '공유 채팅에서 사용자가 확인한 일정 취소'
      ELSE '공유 채팅에서 사용자가 확인한 취소 일정 복원'
    END,
    1.00,
    v_recorded_at,
    'schedule',
    v_receipt.action_id,
    v_receipt.confirmation_message_id,
    v_actor_role,
    v_confirmed_at,
    jsonb_build_object(
      'origin', 'amora_shared_action',
      'mutationKind', v_expected_kind,
      'actionId', v_receipt.action_id,
      'proposalMessageId', v_receipt.source_message_id,
      'confirmationMessageId', v_receipt.confirmation_message_id,
      'requestKey', v_receipt.request_key,
      'operationKey', v_receipt.operation_key,
      'eventId', v_receipt.schedule_event_id,
      'receiptExpectedRevision', v_receipt.expected_revision,
      'receiptAppliedRevision', v_receipt.applied_revision
    ),
    'shared',
    v_recorded_at,
    v_recorded_at
  );

  UPDATE public.amora_shared_action_journey_mutation_receipts
  SET decision_node_id = v_decision_node_id,
      decision_recorded_at = v_recorded_at
  WHERE couple_id = v_receipt.couple_id
    AND request_key = v_receipt.request_key
    AND operation_key = v_receipt.operation_key
    AND action_id = v_receipt.action_id
    AND expected_revision = v_receipt.expected_revision
    AND applied_revision = v_receipt.applied_revision
    AND decision_node_id IS NULL
    AND decision_recorded_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_STATE_DECISION_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS
  trg_record_amora_shared_schedule_cancel_restore_decision
  ON public.amora_tool_executions;
CREATE TRIGGER trg_record_amora_shared_schedule_cancel_restore_decision
  AFTER UPDATE OF status ON public.amora_tool_executions
  FOR EACH ROW
  EXECUTE FUNCTION
    public.record_amora_shared_schedule_cancel_restore_decision();

CREATE OR REPLACE FUNCTION public.reject_legacy_schedule_delete_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.tool_name = 'delete_schedule_event'
     AND NEW.status = 'completed'
     AND jsonb_typeof(NEW.result -> 'success') = 'boolean'
     AND (NEW.result ->> 'success')::boolean THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_HARD_DELETE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_reject_legacy_schedule_delete_completion
  ON public.amora_tool_executions;
CREATE TRIGGER trg_00_reject_legacy_schedule_delete_completion
  BEFORE INSERT OR UPDATE ON public.amora_tool_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_legacy_schedule_delete_completion();

ALTER FUNCTION public.amora_manual_schedule_event_is_valid(jsonb, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.amora_manual_schedule_assignee_label(jsonb, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.amora_manual_schedule_field_value(
  jsonb, text, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.amora_manual_schedule_delta(jsonb, jsonb, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.amora_manual_schedule_intent_digest(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.amora_manual_schedule_canonical_changes(
  jsonb, jsonb, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION
  public.submit_couple_plan_change_before_manual_schedule_clock(
    uuid, uuid, bigint, jsonb, text, text
  ) OWNER TO postgres;
ALTER FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.prepare_amora_manual_plan_change_request()
  OWNER TO postgres;
ALTER FUNCTION public.record_amora_manual_plan_change_decision()
  OWNER TO postgres;
ALTER FUNCTION
  public.capture_amora_shared_schedule_cancel_restore_delta()
  OWNER TO postgres;
ALTER FUNCTION
  public.record_amora_shared_schedule_cancel_restore_decision()
  OWNER TO postgres;
ALTER FUNCTION public.reject_legacy_schedule_delete_completion()
  OWNER TO postgres;
ALTER FUNCTION public.amora_shared_action_policy(text, jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.enforce_amora_shared_action_execution()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.amora_manual_schedule_event_is_valid(
  jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_manual_schedule_assignee_label(
  jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_manual_schedule_field_value(
  jsonb, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_manual_schedule_delta(
  jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_manual_schedule_intent_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_manual_schedule_canonical_changes(
  jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.submit_couple_plan_change_before_manual_schedule_clock(
    uuid, uuid, bigint, jsonb, text, text
  ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_is_high_impact(
  date, date, text, text, bigint, bigint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.couple_plan_change_is_high_impact_before_manual_schedule(
    date, date, text, text, bigint, bigint, jsonb, jsonb
  ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.couple_plan_change_exact_high_summary(
  date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.couple_plan_change_exact_high_summary_before_manual_schedule(
    date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
  ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_amora_manual_plan_change_request()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_amora_manual_plan_change_decision()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.capture_amora_shared_schedule_cancel_restore_delta()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.record_amora_shared_schedule_cancel_restore_decision()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_legacy_schedule_delete_completion()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_amora_shared_action_execution()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postcheck$
DECLARE
  v_prepare_trigger_count integer;
  v_decision_trigger_count integer;
  v_booking_trigger_count integer;
  v_shared_state_trigger_count integer;
  v_insecure_function_count integer;
  v_booking_wrapper_issue_count integer;
  v_submit_wrapper_issue_count integer;
BEGIN
  SELECT count(*)::integer INTO v_prepare_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.couple_plan_change_requests'::regclass
    AND tgname = 'trg_00_prepare_amora_manual_plan_change_request'
    AND tgenabled = 'O'
    AND NOT tgisinternal;
  SELECT count(*)::integer INTO v_decision_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.couple_plan_change_requests'::regclass
    AND tgname = 'trg_record_amora_manual_plan_change_decision'
    AND tgenabled = 'O'
    AND NOT tgisinternal;
  SELECT count(*)::integer INTO v_booking_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.wedding_journeys'::regclass
    AND tgname IN (
      'trg_00_authorize_booking_projection',
      'trg_01_clear_booking_projection_boundary_alias'
    )
    AND tgenabled = 'O'
    AND NOT tgisinternal;
  SELECT count(*)::integer INTO v_shared_state_trigger_count
  FROM pg_trigger
  WHERE (
      (
        tgrelid = 'public.wedding_journeys'::regclass
        AND tgname =
          'trg_capture_amora_shared_schedule_cancel_restore_delta'
      ) OR (
        tgrelid = 'public.amora_tool_executions'::regclass
        AND tgname IN (
          'trg_record_amora_shared_schedule_cancel_restore_decision',
          'trg_00_reject_legacy_schedule_delete_completion'
        )
      )
    )
    AND tgenabled = 'O'
    AND NOT tgisinternal;
  SELECT count(*)::integer INTO v_insecure_function_count
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname IN (
      'amora_manual_schedule_event_is_valid',
      'amora_manual_schedule_assignee_label',
      'amora_manual_schedule_field_value',
      'amora_manual_schedule_delta',
      'amora_manual_schedule_intent_digest',
      'amora_manual_schedule_canonical_changes',
      'submit_couple_plan_change_before_manual_schedule_clock',
      'prepare_amora_manual_plan_change_request',
      'record_amora_manual_plan_change_decision',
      'authorize_booking_projection_journey_write',
      'clear_booking_projection_boundary_alias',
      'apply_booking_progress_projection_before_manual_schedule',
      'capture_amora_shared_schedule_cancel_restore_delta',
      'record_amora_shared_schedule_cancel_restore_decision',
      'reject_legacy_schedule_delete_completion',
      'enforce_amora_shared_action_execution'
    )
    AND (
      NOT procedure.prosecdef
      OR pg_get_userbyid(procedure.proowner) <> 'postgres'
      OR COALESCE(procedure.proconfig, ARRAY[]::text[])
         @> ARRAY['search_path=public']::text[]
      OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      OR has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    );
  SELECT count(*)::integer INTO v_booking_wrapper_issue_count
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.oid = to_regprocedure(
      'public.apply_booking_progress_projection(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)'
    )
    AND (
      NOT procedure.prosecdef
      OR pg_get_userbyid(procedure.proowner) <> 'postgres'
      OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    );
  SELECT count(*)::integer INTO v_submit_wrapper_issue_count
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.oid = to_regprocedure(
      'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)'
    )
    AND (
      NOT procedure.prosecdef
      OR pg_get_userbyid(procedure.proowner) <> 'postgres'
      OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    );

  IF v_prepare_trigger_count <> 1
     OR v_decision_trigger_count <> 1
     OR v_booking_trigger_count <> 2
     OR v_shared_state_trigger_count <> 3
     OR v_insecure_function_count <> 0
     OR v_booking_wrapper_issue_count <> 0
     OR v_submit_wrapper_issue_count <> 0
     OR to_regprocedure(
          'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)'
        ) IS NULL
     OR to_regprocedure(
          'public.amora_manual_schedule_intent_digest(jsonb)'
        ) IS NULL
     OR to_regprocedure(
          'public.amora_manual_schedule_canonical_changes(jsonb,jsonb,uuid,uuid)'
        ) IS NULL
     OR to_regprocedure(
          'public.apply_booking_progress_projection(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)'
        ) IS NULL
     OR to_regprocedure(
          'public.apply_booking_progress_projection_before_manual_schedule(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)'
        ) IS NULL
     OR to_regprocedure(
          'public.submit_couple_plan_change_before_manual_schedule_clock(uuid,uuid,bigint,jsonb,text,text)'
        ) IS NULL
     OR has_function_privilege(
          'service_role',
          'public.submit_couple_plan_change_before_manual_schedule_clock(uuid,uuid,bigint,jsonb,text,text)',
          'EXECUTE'
        )
     OR has_function_privilege(
          'service_role',
          'public.apply_booking_progress_projection_before_manual_schedule(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)',
          'EXECUTE'
        )
     OR has_table_privilege(
          'service_role',
          'public.booking_projection_write_authorizations',
          'SELECT'
        )
     OR public.amora_shared_action_policy(
          'cancel_schedule_event',
          jsonb_build_object(
            'event_id', 'event',
            'expected_title', 'title',
            'expected_date', '2027-01-01'
          )
        ) <> 'couple'
     OR public.amora_shared_action_policy(
          'restore_schedule_event',
          jsonb_build_object(
            'event_id', 'event',
            'expected_title', 'title',
            'expected_date', '2027-01-01'
          )
        ) <> 'couple'
     OR public.amora_shared_action_policy(
          'delete_schedule_event',
          jsonb_build_object('event_id', 'event')
        ) <> 'blocked'
     OR EXISTS (
       SELECT 1
       FROM public.couple_plan_change_requests AS request
       WHERE request.status = 'applied'
         AND NOT EXISTS (
           SELECT 1
           FROM public.decision_nodes AS decision
           WHERE decision.source_ref_id = request.id
             AND decision.source IN ('manual', 'schedule')
             AND decision.metadata ->> 'origin' =
                 'couple_plan_change_request'
         )
     ) THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_POSTCHECK_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$postcheck$;

COMMENT ON COLUMN public.couple_plan_change_requests.schedule_mutation_kind IS
  'Server-derived exact manual schedule mutation: add, update, cancel, restore.';
COMMENT ON COLUMN public.couple_plan_change_requests.schedule_before_event IS
  'Canonical event before a manual schedule mutation; NULL only for add/non-schedule.';
COMMENT ON COLUMN public.couple_plan_change_requests.schedule_after_event IS
  'Canonical event after a manual schedule mutation, captured before approval.';
COMMENT ON FUNCTION public.amora_manual_schedule_delta(
  jsonb, jsonb, uuid, uuid
) IS
  'Fail-closed one-event manual schedule delta and exact Korean approval summary.';
COMMENT ON FUNCTION public.amora_manual_schedule_canonical_changes(
  jsonb, jsonb, uuid, uuid
) IS
  'Replaces client schedule audit clocks with one bounded database timestamp before digest, approval, and apply.';
COMMENT ON FUNCTION public.submit_couple_plan_change(
  uuid, uuid, bigint, jsonb, text, text
) IS
  'Canonicalizes manual schedule audit clocks and preserves semantic retry idempotency before the reviewed plan-change RPC.';
COMMENT ON COLUMN
  public.amora_shared_action_journey_mutation_receipts.mutation_kind IS
  'Exact guarded schedule delta: add, update, cancel, or restore.';
COMMENT ON FUNCTION
  public.capture_amora_shared_schedule_cancel_restore_delta() IS
  'Binds an approved cancel/restore to one canonical event, final actor, human-readable target, and exact before/after receipt.';
COMMENT ON TABLE public.booking_projection_write_authorizations IS
  'Private one-use capabilities minted only by the booking projection wrapper for its exact claimed journey write.';
COMMENT ON FUNCTION public.apply_booking_progress_projection(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) IS
  'Preserves the booking outbox RPC while granting one unforgeable journey-write capability to its private reviewed implementation.';

COMMIT;
