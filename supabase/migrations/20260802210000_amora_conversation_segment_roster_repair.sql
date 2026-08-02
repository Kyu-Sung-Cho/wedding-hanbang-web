BEGIN;

-- The permanent roster-epoch and current-membership privacy fences remain the
-- authority for public membership changes. This migration only keeps private
-- segment ownership coherent when an allowed owner-level repair (or an
-- unsealed couple's initial construction) changes a raw roster slot.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.couples, public.conversation_segments
  IN SHARE ROW EXCLUSIVE MODE;

DO $precondition_guard$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.conversation_segments') IS NULL
     OR to_regprocedure(
       'public.ensure_amora_initial_conversation_segments()'
     ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_ROSTER_REPAIR_PREREQUISITE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'public.couples'::regclass
       AND trigger.tgname =
         'trg_zz_ensure_amora_initial_conversation_segments'
       AND NOT trigger.tgisinternal
       AND trigger.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_ROSTER_REPAIR_TRIGGER_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$precondition_guard$;

CREATE OR REPLACE FUNCTION public.ensure_amora_initial_conversation_segments()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_previous_bride_segment_id uuid;
  v_previous_groom_segment_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.bride_id IS NOT DISTINCT FROM OLD.bride_id
     AND NEW.groom_id IS NOT DISTINCT FROM OLD.groom_id THEN
    RETURN NEW;
  END IF;

  IF NEW.bride_id IS NOT NULL
     AND NEW.bride_id IS NOT DISTINCT FROM NEW.groom_id THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_COUPLE_ROSTER_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Close every changed private lane before creating any replacement. That
  -- ordering also supports an owner-level role swap without briefly violating
  -- the one-active-private-owner index.
  IF TG_OP = 'UPDATE'
     AND NEW.bride_id IS DISTINCT FROM OLD.bride_id THEN
    UPDATE public.conversation_segments AS segment
       SET status = 'closed',
           closed_at = v_now
     WHERE segment.couple_id = NEW.id
       AND segment.visibility = 'bride_private'
       AND segment.status = 'active'
    RETURNING segment.id INTO v_previous_bride_segment_id;

    IF v_previous_bride_segment_id IS NULL THEN
      SELECT segment.id
        INTO v_previous_bride_segment_id
        FROM public.conversation_segments AS segment
       WHERE segment.couple_id = NEW.id
         AND segment.visibility = 'bride_private'
         AND segment.status = 'closed'
       ORDER BY segment.started_at DESC, segment.id DESC
       LIMIT 1;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.groom_id IS DISTINCT FROM OLD.groom_id THEN
    UPDATE public.conversation_segments AS segment
       SET status = 'closed',
           closed_at = v_now
     WHERE segment.couple_id = NEW.id
       AND segment.visibility = 'groom_private'
       AND segment.status = 'active'
    RETURNING segment.id INTO v_previous_groom_segment_id;

    IF v_previous_groom_segment_id IS NULL THEN
      SELECT segment.id
        INTO v_previous_groom_segment_id
        FROM public.conversation_segments AS segment
       WHERE segment.couple_id = NEW.id
         AND segment.visibility = 'groom_private'
         AND segment.status = 'closed'
       ORDER BY segment.started_at DESC, segment.id DESC
       LIMIT 1;
    END IF;
  END IF;

  IF COALESCE(NEW.bride_id, NEW.groom_id) IS NOT NULL THEN
    INSERT INTO public.conversation_segments (
      couple_id, visibility, owner_user_id, status, started_by,
      start_reason, started_at, created_at
    )
    SELECT
      NEW.id, 'shared', NULL, 'active',
      COALESCE(NEW.bride_id, NEW.groom_id), 'initial', v_now, v_now
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.conversation_segments AS segment
       WHERE segment.couple_id = NEW.id
         AND segment.visibility = 'shared'
         AND segment.status = 'active'
    );
  END IF;

  IF NEW.bride_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.bride_id IS DISTINCT FROM OLD.bride_id
     ) THEN
    INSERT INTO public.conversation_segments (
      couple_id, visibility, owner_user_id, status, started_by,
      start_reason, started_at, previous_segment_id, created_at
    )
    VALUES (
      NEW.id, 'bride_private', NEW.bride_id, 'active', NEW.bride_id,
      'initial', v_now, v_previous_bride_segment_id, v_now
    );
  END IF;

  IF NEW.groom_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.groom_id IS DISTINCT FROM OLD.groom_id
     ) THEN
    INSERT INTO public.conversation_segments (
      couple_id, visibility, owner_user_id, status, started_by,
      start_reason, started_at, previous_segment_id, created_at
    )
    VALUES (
      NEW.id, 'groom_private', NEW.groom_id, 'active', NEW.groom_id,
      'initial', v_now, v_previous_groom_segment_id, v_now
    );
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.ensure_amora_initial_conversation_segments()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_amora_initial_conversation_segments()
  FROM PUBLIC, anon, authenticated, service_role;

-- Repair a staging database that observed an owner-level roster write after
-- dual-write but before this follow-up. Historical message and summary links
-- are intentionally immutable; only the stale active boundary is closed.
WITH repair_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
)
UPDATE public.conversation_segments AS segment
   SET status = 'closed',
       closed_at = repair_clock.at
  FROM public.couples AS couple, repair_clock
 WHERE segment.couple_id = couple.id
   AND segment.visibility = 'bride_private'
   AND segment.status = 'active'
   AND segment.owner_user_id IS DISTINCT FROM couple.bride_id;

WITH repair_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
)
UPDATE public.conversation_segments AS segment
   SET status = 'closed',
       closed_at = repair_clock.at
  FROM public.couples AS couple, repair_clock
 WHERE segment.couple_id = couple.id
   AND segment.visibility = 'groom_private'
   AND segment.status = 'active'
   AND segment.owner_user_id IS DISTINCT FROM couple.groom_id;

WITH repair_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
)
INSERT INTO public.conversation_segments (
  couple_id, visibility, owner_user_id, status, started_by,
  start_reason, started_at, created_at
)
SELECT
  couple.id, 'shared', NULL, 'active',
  COALESCE(couple.bride_id, couple.groom_id), 'migration',
  repair_clock.at, repair_clock.at
FROM public.couples AS couple
CROSS JOIN repair_clock
WHERE COALESCE(couple.bride_id, couple.groom_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM public.conversation_segments AS segment
     WHERE segment.couple_id = couple.id
       AND segment.visibility = 'shared'
       AND segment.status = 'active'
  );

WITH repair_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
)
INSERT INTO public.conversation_segments (
  couple_id, visibility, owner_user_id, status, started_by,
  start_reason, started_at, previous_segment_id, created_at
)
SELECT
  couple.id, 'bride_private', couple.bride_id, 'active',
  couple.bride_id, 'migration', repair_clock.at,
  previous.id, repair_clock.at
FROM public.couples AS couple
CROSS JOIN repair_clock
LEFT JOIN LATERAL (
  SELECT segment.id
    FROM public.conversation_segments AS segment
   WHERE segment.couple_id = couple.id
     AND segment.visibility = 'bride_private'
     AND segment.status = 'closed'
   ORDER BY segment.started_at DESC, segment.id DESC
   LIMIT 1
) AS previous ON true
WHERE couple.bride_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM public.conversation_segments AS segment
     WHERE segment.couple_id = couple.id
       AND segment.visibility = 'bride_private'
       AND segment.status = 'active'
  );

WITH repair_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
)
INSERT INTO public.conversation_segments (
  couple_id, visibility, owner_user_id, status, started_by,
  start_reason, started_at, previous_segment_id, created_at
)
SELECT
  couple.id, 'groom_private', couple.groom_id, 'active',
  couple.groom_id, 'migration', repair_clock.at,
  previous.id, repair_clock.at
FROM public.couples AS couple
CROSS JOIN repair_clock
LEFT JOIN LATERAL (
  SELECT segment.id
    FROM public.conversation_segments AS segment
   WHERE segment.couple_id = couple.id
     AND segment.visibility = 'groom_private'
     AND segment.status = 'closed'
   ORDER BY segment.started_at DESC, segment.id DESC
   LIMIT 1
) AS previous ON true
WHERE couple.groom_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM public.conversation_segments AS segment
     WHERE segment.couple_id = couple.id
       AND segment.visibility = 'groom_private'
       AND segment.status = 'active'
  );

DO $postcondition_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_proc AS function
        ON function.oid = trigger.tgfoid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE trigger.tgrelid = 'public.couples'::regclass
       AND trigger.tgname =
         'trg_zz_ensure_amora_initial_conversation_segments'
       AND NOT trigger.tgisinternal
       AND trigger.tgenabled <> 'D'
       AND trigger.tgfoid =
         'public.ensure_amora_initial_conversation_segments()'::regprocedure
       AND namespace.nspname = 'public'
       AND function.proname =
         'ensure_amora_initial_conversation_segments'
  ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_ROSTER_REPAIR_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.conversation_segments AS segment
      JOIN public.couples AS couple ON couple.id = segment.couple_id
     WHERE segment.status = 'active'
       AND (
         (
           segment.visibility = 'bride_private'
           AND segment.owner_user_id IS DISTINCT FROM couple.bride_id
         )
         OR (
           segment.visibility = 'groom_private'
           AND segment.owner_user_id IS DISTINCT FROM couple.groom_id
         )
       )
  ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_ROSTER_REPAIR_OWNER_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.couples AS couple
     WHERE (
       COALESCE(couple.bride_id, couple.groom_id) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.conversation_segments AS segment
          WHERE segment.couple_id = couple.id
            AND segment.visibility = 'shared'
            AND segment.status = 'active'
       )
     )
     OR (
       couple.bride_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.conversation_segments AS segment
          WHERE segment.couple_id = couple.id
            AND segment.visibility = 'bride_private'
            AND segment.owner_user_id = couple.bride_id
            AND segment.status = 'active'
       )
     )
     OR (
       couple.groom_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.conversation_segments AS segment
          WHERE segment.couple_id = couple.id
            AND segment.visibility = 'groom_private'
            AND segment.owner_user_id = couple.groom_id
            AND segment.status = 'active'
       )
     )
  ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_ROSTER_REPAIR_ACTIVE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$postcondition_guard$;

COMMENT ON FUNCTION public.ensure_amora_initial_conversation_segments() IS
  'Maintains active Amora lanes after allowed raw-roster construction or owner-level repair; public replacement remains governed by the permanent roster-epoch fence.';

COMMIT;
