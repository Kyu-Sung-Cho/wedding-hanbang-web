BEGIN;

-- Product decisions must be durable in the same transaction as their
-- canonical row.  These nodes are explicit product state, not chat-derived
-- Amora memory, so memory_key/source_actor_role intentionally stay NULL.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Adopt nodes written by the former route-level best-effort hooks.  Keeping
-- their ids preserves history while giving the database one stable identity
-- for future idempotency and supersession.
UPDATE public.decision_nodes
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_identity', 'booking:' || source_ref_id::text,
      'canonical_table', 'vendor_bookings',
      'canonical_field', 'status',
      'legacy_route_record', true
    ),
    updated_at = now()
WHERE source = 'vendor_booking'
  AND decision_type = 'booked'
  AND source_ref_id IS NOT NULL
  AND COALESCE(metadata, '{}'::jsonb) ->> 'hook' = 'bookings';

UPDATE public.decision_nodes
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_identity', 'favorite:' || source_ref_id::text,
      'canonical_table', 'vendor_favorites',
      'canonical_field', 'presence',
      'legacy_route_record', true
    ),
    updated_at = now()
WHERE source = 'manual'
  AND decision_type = 'considering'
  AND source_ref_id IS NOT NULL
  AND COALESCE(metadata, '{}'::jsonb) ->> 'hook' = 'favorites';

UPDATE public.decision_nodes
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_identity', 'journey:wedding_date',
      'canonical_table', 'wedding_journeys',
      'canonical_field', 'wedding_date',
      'legacy_route_record', true
    ),
    updated_at = now()
WHERE source = 'onboarding'
  AND COALESCE(metadata, '{}'::jsonb) ->> 'hook' = 'onboarding'
  AND COALESCE(chosen_value, '{}'::jsonb) ? 'wedding_date';

UPDATE public.decision_nodes
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_identity', 'journey:venue',
      'canonical_table', 'wedding_journeys',
      'canonical_field', 'venue',
      'legacy_route_record', true
    ),
    updated_at = now()
WHERE source = 'onboarding'
  AND COALESCE(metadata, '{}'::jsonb) ->> 'hook' = 'onboarding'
  AND COALESCE(chosen_value, '{}'::jsonb) ? 'venue';

UPDATE public.decision_nodes
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_identity', 'journey:total_budget',
      'canonical_table', 'wedding_journeys',
      'canonical_field', 'total_budget',
      'legacy_route_record', true
    ),
    updated_at = now()
WHERE source = 'onboarding'
  AND COALESCE(metadata, '{}'::jsonb) ->> 'hook' = 'onboarding'
  AND COALESCE(chosen_value, '{}'::jsonb) ? 'total_budget';

UPDATE public.decision_nodes
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_identity', 'journey:sanggyeonrye_date',
      'canonical_table', 'wedding_journeys',
      'canonical_field', 'sanggyeonrye_date',
      'legacy_route_record', true
    ),
    updated_at = now()
WHERE source = 'onboarding'
  AND COALESCE(metadata, '{}'::jsonb) ->> 'hook' = 'onboarding'
  AND COALESCE(chosen_value, '{}'::jsonb) ? 'sanggyeonrye_date';

-- Retire any duplicate active legacy hooks before enforcing the active
-- canonical identity.  The newest node is retained and older content remains
-- queryable through supersession links.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY couple_id, visibility,
        COALESCE(source_actor_role, 'legacy'),
        metadata ->> 'canonical_identity'
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY couple_id, visibility,
        COALESCE(source_actor_role, 'legacy'),
        metadata ->> 'canonical_identity'
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS position
  FROM public.decision_nodes
  WHERE metadata ->> 'canonical_identity' IS NOT NULL
    AND superseded_at IS NULL
)
UPDATE public.decision_nodes AS decision
SET superseded_at = now(),
    superseded_by = ranked.canonical_id,
    metadata = COALESCE(decision.metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_duplicate_retired', true,
      'canonical_duplicate_retired_at', now()
    ),
    updated_at = now()
FROM ranked
WHERE ranked.id = decision.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS decision_nodes_active_canonical_identity_unique
  ON public.decision_nodes (
    couple_id,
    visibility,
    COALESCE(source_actor_role, 'legacy'),
    (metadata ->> 'canonical_identity')
  )
  WHERE metadata ->> 'canonical_identity' IS NOT NULL
    AND superseded_at IS NULL;

CREATE OR REPLACE FUNCTION public.write_canonical_decision_node(
  p_couple_id uuid,
  p_identity text,
  p_category text,
  p_decision_type text,
  p_title text,
  p_chosen_value jsonb,
  p_source text,
  p_source_ref_id uuid,
  p_source_actor_role text,
  p_confidence numeric,
  p_stage_tag text,
  p_metadata jsonb,
  p_append_on_change boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_existing public.decision_nodes%ROWTYPE;
  v_new_id uuid;
  v_now timestamptz := now();
  v_retired_ids uuid[];
  v_metadata jsonb;
BEGIN
  IF p_couple_id IS NULL
     OR p_identity IS NULL
     OR char_length(p_identity) NOT BETWEEN 3 AND 128
     OR p_identity !~ '^[a-z_]+:[a-z0-9_:-]+$'
     OR p_category IS NULL
     OR p_decision_type NOT IN (
       'exploring', 'considering', 'decided', 'scheduled', 'booked', 'completed'
     )
     OR p_title IS NULL
     OR char_length(p_title) NOT BETWEEN 1 AND 160
     OR p_chosen_value IS NULL
     OR jsonb_typeof(p_chosen_value) <> 'object'
     OR p_source NOT IN (
       'chat', 'manual', 'import', 'vendor_booking', 'schedule', 'budget',
       'onboarding', 'community'
     )
     OR p_source_actor_role IS NOT NULL
        AND p_source_actor_role NOT IN ('bride', 'groom')
     OR p_confidence IS NULL
     OR p_confidence < 0
     OR p_confidence > 1
     OR p_stage_tag IS NOT NULL
        AND p_stage_tag NOT IN (
          'planning_0', 'preparation_1', 'execution_2', 'ceremony_3', 'settlement_4'
        )
     OR p_metadata IS NULL
     OR jsonb_typeof(p_metadata) <> 'object'
     OR p_append_on_change IS NULL THEN
    RAISE EXCEPTION 'CANONICAL_DECISION_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:canonical-decision:' || p_couple_id::text || ':'
        || COALESCE(p_source_actor_role, 'shared') || ':' || p_identity,
      0
    )
  );

  v_metadata := p_metadata || jsonb_build_object(
    'canonical_identity', p_identity,
    'recorded_by', 'database_trigger'
  );

  SELECT * INTO v_existing
  FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND visibility = 'shared'
    AND source_actor_role IS NOT DISTINCT FROM p_source_actor_role
    AND metadata ->> 'canonical_identity' = p_identity
    AND superseded_at IS NULL
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND (
       NOT p_append_on_change
       OR (
         v_existing.chosen_value IS NOT DISTINCT FROM p_chosen_value
         AND v_existing.decision_type IS NOT DISTINCT FROM p_decision_type
       )
     ) THEN
    UPDATE public.decision_nodes
    SET category = p_category,
        decision_type = p_decision_type,
        title = p_title,
        chosen_value = p_chosen_value,
        confidence = p_confidence,
        stage_tag = p_stage_tag,
        source = p_source,
        source_ref_id = p_source_ref_id,
        metadata = COALESCE(metadata, '{}'::jsonb) || v_metadata,
        decided_at = CASE
          WHEN p_decision_type IN ('decided', 'scheduled', 'booked', 'completed')
            THEN COALESCE(decided_at, v_now)
          ELSE NULL
        END,
        memory_key = NULL,
        source_message_id = NULL,
        source_actor_role = p_source_actor_role,
        superseded_at = NULL,
        superseded_by = NULL,
        updated_at = v_now
    WHERE id = v_existing.id;
    RETURN v_existing.id;
  END IF;

  v_new_id := gen_random_uuid();

  WITH retired AS (
    UPDATE public.decision_nodes
    SET superseded_at = v_now,
        superseded_by = NULL,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'canonical_superseded_at', v_now
        ),
        updated_at = v_now
    WHERE couple_id = p_couple_id
      AND visibility = 'shared'
      AND source_actor_role IS NOT DISTINCT FROM p_source_actor_role
      AND metadata ->> 'canonical_identity' = p_identity
      AND superseded_at IS NULL
    RETURNING id
  )
  SELECT array_agg(id) INTO v_retired_ids FROM retired;

  INSERT INTO public.decision_nodes (
    id,
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    confidence,
    stage_tag,
    decided_at,
    source,
    source_ref_id,
    metadata,
    visibility,
    memory_key,
    source_message_id,
    source_actor_role,
    superseded_at,
    superseded_by,
    updated_at
  ) VALUES (
    v_new_id,
    p_couple_id,
    p_category,
    p_decision_type,
    p_title,
    p_chosen_value,
    p_confidence,
    p_stage_tag,
    CASE
      WHEN p_decision_type IN ('decided', 'scheduled', 'booked', 'completed')
        THEN v_now
      ELSE NULL
    END,
    p_source,
    p_source_ref_id,
    v_metadata,
    'shared',
    NULL,
    NULL,
    p_source_actor_role,
    NULL,
    NULL,
    v_now
  );

  IF v_retired_ids IS NOT NULL THEN
    UPDATE public.decision_nodes
    SET superseded_by = v_new_id,
        updated_at = v_now
    WHERE id = ANY(v_retired_ids);
  END IF;

  -- Re-activation after a prior removal/cancellation has no active predecessor
  -- in v_retired_ids. Link the newest unlinked historical state to this node so
  -- the lifecycle remains traversable without reviving the retired row.
  UPDATE public.decision_nodes
  SET superseded_by = v_new_id,
      updated_at = v_now
  WHERE id = (
    SELECT id
    FROM public.decision_nodes
    WHERE couple_id = p_couple_id
      AND visibility = 'shared'
      AND source_actor_role IS NOT DISTINCT FROM p_source_actor_role
      AND metadata ->> 'canonical_identity' = p_identity
      AND superseded_at IS NOT NULL
      AND superseded_by IS NULL
      AND id <> v_new_id
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    LIMIT 1
  );

  RETURN v_new_id;
END
$function$;

ALTER FUNCTION public.write_canonical_decision_node(
  uuid, text, text, text, text, jsonb, text, uuid, text, numeric, text, jsonb, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.write_canonical_decision_node(
  uuid, text, text, text, text, jsonb, text, uuid, text, numeric, text, jsonb, boolean
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.retire_canonical_decision_node(
  p_couple_id uuid,
  p_identity text,
  p_source_actor_role text,
  p_reason text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_couple_id IS NULL
     OR p_identity IS NULL
     OR char_length(p_identity) NOT BETWEEN 3 AND 128
     OR p_identity !~ '^[a-z_]+:[a-z0-9_:-]+$'
     OR p_source_actor_role IS NOT NULL
        AND p_source_actor_role NOT IN ('bride', 'groom')
     OR p_reason IS NULL
     OR char_length(p_reason) NOT BETWEEN 1 AND 80
     OR p_metadata IS NULL
     OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'CANONICAL_DECISION_RETIRE_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:canonical-decision:' || p_couple_id::text || ':'
        || COALESCE(p_source_actor_role, 'shared') || ':' || p_identity,
      0
    )
  );

  UPDATE public.decision_nodes
  SET superseded_at = v_now,
      superseded_by = NULL,
      metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object(
        'canonical_identity', p_identity,
        'canonical_retired', true,
        'canonical_retired_at', v_now,
        'canonical_retired_reason', p_reason
      ),
      updated_at = v_now
  WHERE couple_id = p_couple_id
    AND visibility = 'shared'
    AND source_actor_role IS NOT DISTINCT FROM p_source_actor_role
    AND metadata ->> 'canonical_identity' = p_identity
    AND superseded_at IS NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END
$function$;

ALTER FUNCTION public.retire_canonical_decision_node(uuid, text, text, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.retire_canonical_decision_node(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.canonical_wedding_stage(p_wedding_date date)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_wedding_date IS NULL THEN 'planning_0'
    WHEN p_wedding_date > current_date + 180 THEN 'planning_0'
    WHEN p_wedding_date > current_date + 30 THEN 'preparation_1'
    WHEN p_wedding_date > current_date THEN 'execution_2'
    WHEN p_wedding_date = current_date THEN 'ceremony_3'
    ELSE 'settlement_4'
  END
$function$;

ALTER FUNCTION public.canonical_wedding_stage(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.canonical_wedding_stage(date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.canonical_sanggyeonrye_date(p_progress jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT event.value ->> 'date'
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(p_progress, '{}'::jsonb) -> '__events') = 'array'
        THEN COALESCE(p_progress, '{}'::jsonb) -> '__events'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS event(value, position)
  WHERE event.value ->> 'momentType' = 'sanggyeonrye'
    AND event.value ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ORDER BY event.position
  LIMIT 1
$function$;

ALTER FUNCTION public.canonical_sanggyeonrye_date(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.canonical_sanggyeonrye_date(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_vendor_booking_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_booking public.vendor_bookings%ROWTYPE;
  v_vendor_name text;
  v_vendor_category text;
  v_identity text;
BEGIN
  v_booking := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_identity := 'booking:' || v_booking.id::text;

  IF TG_OP = 'DELETE' OR v_booking.status IN (
    'cancelled', 'completed', 'service_completed', 'settled'
  ) THEN
    PERFORM public.retire_canonical_decision_node(
      v_booking.couple_id,
      v_identity,
      NULL,
      CASE
        WHEN TG_OP = 'DELETE' THEN 'booking_deleted'
        WHEN v_booking.status = 'cancelled' THEN 'booking_cancelled'
        ELSE 'booking_completed'
      END,
      jsonb_build_object(
        'canonical_table', 'vendor_bookings',
        'canonical_field', 'status',
        'terminal_status', CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE v_booking.status END
      )
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT name, category INTO v_vendor_name, v_vendor_category
    FROM public.vendors
    WHERE id = v_booking.vendor_id;

    PERFORM public.write_canonical_decision_node(
      v_booking.couple_id,
      v_identity,
      COALESCE(NULLIF(btrim(v_vendor_category), ''), 'vendor'),
      'booked',
      '예약: ' || COALESCE(NULLIF(btrim(v_vendor_name), ''), '업체'),
      jsonb_build_object(
        'booking_id', v_booking.id,
        'vendor_id', v_booking.vendor_id,
        'vendor_name', v_vendor_name,
        'booking_date', v_booking.booking_date,
        'booking_time', v_booking.booking_time,
        'amount', v_booking.amount,
        'product_id', v_booking.product_id
      ),
      'vendor_booking',
      v_booking.id,
      NULL,
      1.00,
      NULL,
      jsonb_build_object(
        'hook', 'canonical_booking',
        'canonical_table', 'vendor_bookings',
        'canonical_field', 'status',
        'booking_status', v_booking.status
      ),
      false
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$function$;

ALTER FUNCTION public.record_vendor_booking_decision() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_vendor_booking_decision()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_vendor_favorite_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_favorite public.vendor_favorites%ROWTYPE;
  v_couple_id uuid;
  v_actor_role text;
  v_vendor_name text;
  v_vendor_category text;
BEGIN
  v_favorite := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  -- Use the same per-user lock as the membership RPCs, then lock rows in their
  -- established profile -> couple order. This prevents a favorite INSERT that
  -- began before a leave/reset from recreating the departed member's decision
  -- after the roster cleanup trigger has run.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || v_favorite.user_id::text,
      0
    )
  );

  SELECT profile.couple_id
    INTO v_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = v_favorite.user_id
  FOR SHARE;
  IF v_couple_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT CASE
           WHEN couple.bride_id = v_favorite.user_id THEN 'bride'
           WHEN couple.groom_id = v_favorite.user_id THEN 'groom'
           ELSE NULL
         END
    INTO v_actor_role
  FROM public.couples AS couple
  WHERE couple.id = v_couple_id
  FOR SHARE;
  IF v_actor_role IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'FAVORITE_COUPLE_MEMBERSHIP_INVALID' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.retire_canonical_decision_node(
      v_couple_id,
      'favorite:' || v_favorite.vendor_id::text,
      v_actor_role,
      'favorite_removed',
      jsonb_build_object(
        'canonical_table', 'vendor_favorites',
        'canonical_field', 'presence',
        'source_actor_role', v_actor_role
      )
    );
    RETURN OLD;
  END IF;

  SELECT name, category INTO v_vendor_name, v_vendor_category
  FROM public.vendors
  WHERE id = v_favorite.vendor_id;

  PERFORM public.write_canonical_decision_node(
    v_couple_id,
    'favorite:' || v_favorite.vendor_id::text,
    COALESCE(NULLIF(btrim(v_vendor_category), ''), 'vendor'),
    'considering',
    '찜: ' || COALESCE(NULLIF(btrim(v_vendor_name), ''), '업체'),
    jsonb_build_object(
      'vendor_id', v_favorite.vendor_id,
      'vendor_name', v_vendor_name,
      'vendor_category', v_vendor_category
    ),
    'manual',
    v_favorite.vendor_id,
    v_actor_role,
    1.00,
    NULL,
    jsonb_build_object(
      'hook', 'canonical_favorite',
      'canonical_table', 'vendor_favorites',
      'canonical_field', 'presence',
      'source_actor_role', v_actor_role
    ),
    false
  );

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.record_vendor_favorite_decision() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_vendor_favorite_decision()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_couple_favorite_decisions_on_roster_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_member record;
  v_favorite record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.bride_id IS NOT NULL AND OLD.bride_id IS DISTINCT FROM NEW.bride_id THEN
      DELETE FROM public.decision_nodes
      WHERE couple_id = NEW.id
        AND metadata ->> 'canonical_identity' LIKE 'favorite:%'
        AND source_actor_role = 'bride';
    END IF;
    IF OLD.groom_id IS NOT NULL AND OLD.groom_id IS DISTINCT FROM NEW.groom_id THEN
      DELETE FROM public.decision_nodes
      WHERE couple_id = NEW.id
        AND metadata ->> 'canonical_identity' LIKE 'favorite:%'
        AND source_actor_role = 'groom';
    END IF;
  END IF;

  FOR v_member IN
    SELECT member.user_id, member.actor_role
    FROM (VALUES
      (NEW.bride_id, 'bride'::text),
      (NEW.groom_id, 'groom'::text)
    ) AS member(user_id, actor_role)
    WHERE member.user_id IS NOT NULL
  LOOP
    FOR v_favorite IN
      SELECT favorite.vendor_id, vendor.name, vendor.category
      FROM public.vendor_favorites AS favorite
      JOIN public.vendors AS vendor ON vendor.id = favorite.vendor_id
      WHERE favorite.user_id = v_member.user_id
    LOOP
      PERFORM public.write_canonical_decision_node(
        NEW.id,
        'favorite:' || v_favorite.vendor_id::text,
        COALESCE(NULLIF(btrim(v_favorite.category), ''), 'vendor'),
        'considering',
        '찜: ' || COALESCE(NULLIF(btrim(v_favorite.name), ''), '업체'),
        jsonb_build_object(
          'vendor_id', v_favorite.vendor_id,
          'vendor_name', v_favorite.name,
          'vendor_category', v_favorite.category
        ),
        'manual',
        v_favorite.vendor_id,
        v_member.actor_role,
        1.00,
        NULL,
        jsonb_build_object(
          'hook', 'canonical_favorite',
          'canonical_table', 'vendor_favorites',
          'canonical_field', 'presence',
          'source_actor_role', v_member.actor_role,
          'roster_sync', true
        ),
        false
      );
    END LOOP;
  END LOOP;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.sync_couple_favorite_decisions_on_roster_change()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_couple_favorite_decisions_on_roster_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_wedding_journey_decisions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_old_sanggyeonrye text;
  v_new_sanggyeonrye text;
  v_stage text;
BEGIN
  v_stage := public.canonical_wedding_stage(NEW.wedding_date);
  v_new_sanggyeonrye := public.canonical_sanggyeonrye_date(NEW.progress);
  IF TG_OP = 'UPDATE' THEN
    v_old_sanggyeonrye := public.canonical_sanggyeonrye_date(OLD.progress);
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.wedding_date IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND OLD.wedding_date IS DISTINCT FROM NEW.wedding_date) THEN
    PERFORM public.write_canonical_decision_node(
      NEW.couple_id,
      'journey:wedding_date',
      'timeline',
      CASE WHEN NEW.wedding_date IS NULL THEN 'exploring' ELSE 'decided' END,
      CASE WHEN NEW.wedding_date IS NULL THEN '예식일 미정' ELSE '예식일 확정' END,
      jsonb_build_object('wedding_date', NEW.wedding_date),
      'schedule',
      NEW.id,
      NULL,
      1.00,
      v_stage,
      jsonb_build_object(
        'hook', 'canonical_journey',
        'canonical_table', 'wedding_journeys',
        'canonical_field', 'wedding_date'
      ),
      true
    );
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.venue IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND OLD.venue IS DISTINCT FROM NEW.venue) THEN
    PERFORM public.write_canonical_decision_node(
      NEW.couple_id,
      'journey:venue',
      'venue',
      CASE WHEN NEW.venue IS NULL THEN 'exploring' ELSE 'considering' END,
      COALESCE(NEW.venue, '예식장 미정'),
      jsonb_build_object('venue', NEW.venue),
      'manual',
      NEW.id,
      NULL,
      1.00,
      v_stage,
      jsonb_build_object(
        'hook', 'canonical_journey',
        'canonical_table', 'wedding_journeys',
        'canonical_field', 'venue'
      ),
      true
    );
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.total_budget > 0)
     OR (TG_OP = 'UPDATE' AND OLD.total_budget IS DISTINCT FROM NEW.total_budget) THEN
    PERFORM public.write_canonical_decision_node(
      NEW.couple_id,
      'journey:total_budget',
      'budget',
      CASE
        WHEN NEW.total_budget IS NULL OR NEW.total_budget <= 0 THEN 'exploring'
        ELSE 'decided'
      END,
      CASE
        WHEN NEW.total_budget IS NULL OR NEW.total_budget <= 0 THEN '총 예산 미정'
        ELSE '총 예산 설정'
      END,
      jsonb_build_object('total_budget', NEW.total_budget),
      'budget',
      NEW.id,
      NULL,
      1.00,
      v_stage,
      jsonb_build_object(
        'hook', 'canonical_journey',
        'canonical_table', 'wedding_journeys',
        'canonical_field', 'total_budget'
      ),
      true
    );
  END IF;

  IF (TG_OP = 'INSERT' AND v_new_sanggyeonrye IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND v_old_sanggyeonrye IS DISTINCT FROM v_new_sanggyeonrye) THEN
    PERFORM public.write_canonical_decision_node(
      NEW.couple_id,
      'journey:sanggyeonrye_date',
      'timeline',
      CASE WHEN v_new_sanggyeonrye IS NULL THEN 'exploring' ELSE 'decided' END,
      CASE WHEN v_new_sanggyeonrye IS NULL THEN '상견례 일정 미정' ELSE '상견례 일정' END,
      jsonb_build_object('sanggyeonrye_date', v_new_sanggyeonrye),
      'schedule',
      NEW.id,
      NULL,
      1.00,
      v_stage,
      jsonb_build_object(
        'hook', 'canonical_journey',
        'canonical_table', 'wedding_journeys',
        'canonical_field', 'sanggyeonrye_date'
      ),
      true
    );
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.record_wedding_journey_decisions() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_wedding_journey_decisions()
  FROM PUBLIC, anon, authenticated, service_role;

-- Backfill current canonical state before installing the triggers.  Null
-- defaults are not fabricated as decisions; they only retire stale legacy
-- route nodes when one exists.
SELECT public.write_canonical_decision_node(
  booking.couple_id,
  'booking:' || booking.id::text,
  COALESCE(NULLIF(btrim(vendor.category), ''), 'vendor'),
  'booked',
  '예약: ' || COALESCE(NULLIF(btrim(vendor.name), ''), '업체'),
  jsonb_build_object(
    'booking_id', booking.id,
    'vendor_id', booking.vendor_id,
    'vendor_name', vendor.name,
    'booking_date', booking.booking_date,
    'booking_time', booking.booking_time,
    'amount', booking.amount,
    'product_id', booking.product_id
  ),
  'vendor_booking',
  booking.id,
  NULL,
  1.00,
  NULL,
  jsonb_build_object(
    'hook', 'canonical_booking',
    'canonical_table', 'vendor_bookings',
    'canonical_field', 'status',
    'booking_status', booking.status,
    'migration_backfill', true
  ),
  false
)
FROM public.vendor_bookings AS booking
JOIN public.vendors AS vendor ON vendor.id = booking.vendor_id
WHERE booking.status IS NULL
   OR booking.status NOT IN ('cancelled', 'completed', 'service_completed', 'settled');

SELECT public.retire_canonical_decision_node(
  booking.couple_id,
  'booking:' || booking.id::text,
  NULL,
  CASE
    WHEN booking.status = 'cancelled' THEN 'booking_cancelled'
    ELSE 'booking_completed'
  END,
  jsonb_build_object('migration_backfill', true, 'terminal_status', booking.status)
)
FROM public.vendor_bookings AS booking
WHERE booking.status IN ('cancelled', 'completed', 'service_completed', 'settled');

-- The old best-effort route collapsed both partners into an actorless node,
-- so ownership cannot be proven after a roster change. Remove only those
-- adopted legacy hook rows and rebuild from the current user-owned favorites.
DELETE FROM public.decision_nodes
WHERE metadata ->> 'canonical_identity' LIKE 'favorite:%'
  AND source_actor_role IS NULL
  AND COALESCE(metadata, '{}'::jsonb) ->> 'legacy_route_record' = 'true';

SELECT public.write_canonical_decision_node(
  profile.couple_id,
  'favorite:' || favorite.vendor_id::text,
  COALESCE(NULLIF(btrim(vendor.category), ''), 'vendor'),
  'considering',
  '찜: ' || COALESCE(NULLIF(btrim(vendor.name), ''), '업체'),
  jsonb_build_object(
    'vendor_id', favorite.vendor_id,
    'vendor_name', vendor.name,
    'vendor_category', vendor.category
  ),
  'manual',
  favorite.vendor_id,
  CASE
    WHEN couple.bride_id = favorite.user_id THEN 'bride'
    WHEN couple.groom_id = favorite.user_id THEN 'groom'
  END,
  1.00,
  NULL,
  jsonb_build_object(
    'hook', 'canonical_favorite',
    'canonical_table', 'vendor_favorites',
    'canonical_field', 'presence',
    'source_actor_role', CASE
      WHEN couple.bride_id = favorite.user_id THEN 'bride'
      WHEN couple.groom_id = favorite.user_id THEN 'groom'
    END,
    'migration_backfill', true
  ),
  false
)
FROM public.vendor_favorites AS favorite
JOIN public.profiles AS profile ON profile.id = favorite.user_id
JOIN public.couples AS couple ON couple.id = profile.couple_id
JOIN public.vendors AS vendor ON vendor.id = favorite.vendor_id
WHERE favorite.user_id IN (couple.bride_id, couple.groom_id);

SELECT CASE
  WHEN journey.wedding_date IS NULL THEN
    public.retire_canonical_decision_node(
      journey.couple_id, 'journey:wedding_date', NULL, 'canonical_value_absent',
      jsonb_build_object('migration_backfill', true)
    )
  ELSE
    public.write_canonical_decision_node(
      journey.couple_id, 'journey:wedding_date', 'timeline', 'decided',
      '예식일 확정', jsonb_build_object('wedding_date', journey.wedding_date),
      'schedule', journey.id, NULL, 1.00,
      public.canonical_wedding_stage(journey.wedding_date),
      jsonb_build_object(
        'hook', 'canonical_journey', 'canonical_table', 'wedding_journeys',
        'canonical_field', 'wedding_date', 'migration_backfill', true
      ), true
    )
END
FROM public.wedding_journeys AS journey;

SELECT CASE
  WHEN journey.venue IS NULL THEN
    public.retire_canonical_decision_node(
      journey.couple_id, 'journey:venue', NULL, 'canonical_value_absent',
      jsonb_build_object('migration_backfill', true)
    )
  ELSE
    public.write_canonical_decision_node(
      journey.couple_id, 'journey:venue', 'venue', 'considering', journey.venue,
      jsonb_build_object('venue', journey.venue), 'manual', journey.id, NULL, 1.00,
      public.canonical_wedding_stage(journey.wedding_date),
      jsonb_build_object(
        'hook', 'canonical_journey', 'canonical_table', 'wedding_journeys',
        'canonical_field', 'venue', 'migration_backfill', true
      ), true
    )
END
FROM public.wedding_journeys AS journey;

SELECT CASE
  WHEN journey.total_budget IS NULL OR journey.total_budget <= 0 THEN
    public.retire_canonical_decision_node(
      journey.couple_id, 'journey:total_budget', NULL, 'canonical_value_absent',
      jsonb_build_object('migration_backfill', true)
    )
  ELSE
    public.write_canonical_decision_node(
      journey.couple_id, 'journey:total_budget', 'budget', 'decided',
      '총 예산 설정', jsonb_build_object('total_budget', journey.total_budget),
      'budget', journey.id, NULL, 1.00,
      public.canonical_wedding_stage(journey.wedding_date),
      jsonb_build_object(
        'hook', 'canonical_journey', 'canonical_table', 'wedding_journeys',
        'canonical_field', 'total_budget', 'migration_backfill', true
      ), true
    )
END
FROM public.wedding_journeys AS journey;

SELECT CASE
  WHEN public.canonical_sanggyeonrye_date(journey.progress) IS NULL THEN
    public.retire_canonical_decision_node(
      journey.couple_id, 'journey:sanggyeonrye_date', NULL, 'canonical_value_absent',
      jsonb_build_object('migration_backfill', true)
    )
  ELSE
    public.write_canonical_decision_node(
      journey.couple_id, 'journey:sanggyeonrye_date', 'timeline', 'decided',
      '상견례 일정', jsonb_build_object(
        'sanggyeonrye_date', public.canonical_sanggyeonrye_date(journey.progress)
      ), 'schedule', journey.id, NULL, 1.00,
      public.canonical_wedding_stage(journey.wedding_date),
      jsonb_build_object(
        'hook', 'canonical_journey', 'canonical_table', 'wedding_journeys',
        'canonical_field', 'sanggyeonrye_date', 'migration_backfill', true
      ), true
    )
END
FROM public.wedding_journeys AS journey;

DROP TRIGGER IF EXISTS vendor_booking_decision_on_insert
  ON public.vendor_bookings;
CREATE TRIGGER vendor_booking_decision_on_insert
AFTER INSERT ON public.vendor_bookings
FOR EACH ROW EXECUTE FUNCTION public.record_vendor_booking_decision();

DROP TRIGGER IF EXISTS vendor_booking_decision_on_status_update
  ON public.vendor_bookings;
CREATE TRIGGER vendor_booking_decision_on_status_update
AFTER UPDATE OF status ON public.vendor_bookings
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.record_vendor_booking_decision();

DROP TRIGGER IF EXISTS vendor_booking_decision_on_delete
  ON public.vendor_bookings;
CREATE TRIGGER vendor_booking_decision_on_delete
AFTER DELETE ON public.vendor_bookings
FOR EACH ROW EXECUTE FUNCTION public.record_vendor_booking_decision();

DROP TRIGGER IF EXISTS vendor_favorite_decision_on_change
  ON public.vendor_favorites;
CREATE TRIGGER vendor_favorite_decision_on_change
AFTER INSERT OR DELETE ON public.vendor_favorites
FOR EACH ROW EXECUTE FUNCTION public.record_vendor_favorite_decision();

DROP TRIGGER IF EXISTS couple_favorite_decisions_on_insert
  ON public.couples;
CREATE TRIGGER couple_favorite_decisions_on_insert
AFTER INSERT ON public.couples
FOR EACH ROW EXECUTE FUNCTION public.sync_couple_favorite_decisions_on_roster_change();

DROP TRIGGER IF EXISTS couple_favorite_decisions_on_roster_update
  ON public.couples;
CREATE TRIGGER couple_favorite_decisions_on_roster_update
AFTER UPDATE OF bride_id, groom_id ON public.couples
FOR EACH ROW
WHEN (
  OLD.bride_id IS DISTINCT FROM NEW.bride_id
  OR OLD.groom_id IS DISTINCT FROM NEW.groom_id
)
EXECUTE FUNCTION public.sync_couple_favorite_decisions_on_roster_change();

DROP TRIGGER IF EXISTS wedding_journey_decisions_on_insert
  ON public.wedding_journeys;
CREATE TRIGGER wedding_journey_decisions_on_insert
AFTER INSERT ON public.wedding_journeys
FOR EACH ROW EXECUTE FUNCTION public.record_wedding_journey_decisions();

DROP TRIGGER IF EXISTS wedding_journey_decisions_on_update
  ON public.wedding_journeys;
CREATE TRIGGER wedding_journey_decisions_on_update
AFTER UPDATE OF wedding_date, venue, total_budget, progress
ON public.wedding_journeys
FOR EACH ROW EXECUTE FUNCTION public.record_wedding_journey_decisions();

COMMENT ON INDEX public.decision_nodes_active_canonical_identity_unique IS
  'At most one active explicit product decision per couple/canonical identity; chat memory uniqueness remains independent.';
COMMENT ON FUNCTION public.write_canonical_decision_node(
  uuid, text, text, text, text, jsonb, text, uuid, text, numeric, text, jsonb, boolean
) IS
  'Internal trigger helper. Writes or supersedes an explicit product decision atomically with canonical state.';

COMMIT;
