-- The application reads wedding_journeys with maybeSingle()/single() and its
-- onboarding race recovery relies on SQLSTATE 23505. Make that data contract a
-- database invariant without guessing which historical row should survive.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.wedding_journeys
    WHERE couple_id IS NULL
  ) THEN
    RAISE EXCEPTION 'WEDDING_JOURNEY_ORPHAN_BACKFILL_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wedding_journeys
    GROUP BY couple_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'WEDDING_JOURNEY_DUPLICATE_BACKFILL_REQUIRED'
      USING ERRCODE = '23514';
  END IF;
END
$preflight$;

-- Validate with a write-compatible lock before the brief SET NOT NULL lock.
-- PostgreSQL can reuse the validated CHECK proof instead of rescanning the
-- whole table while ACCESS EXCLUSIVE is held.
DO $not_null_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.wedding_journeys'::regclass
      AND constraint_row.conname = 'wedding_journeys_couple_id_not_null'
  ) THEN
    ALTER TABLE public.wedding_journeys
      ADD CONSTRAINT wedding_journeys_couple_id_not_null
      CHECK (couple_id IS NOT NULL)
      NOT VALID;
  END IF;
END
$not_null_contract$;

ALTER TABLE public.wedding_journeys
  VALIDATE CONSTRAINT wedding_journeys_couple_id_not_null;

ALTER TABLE public.wedding_journeys
  ALTER COLUMN couple_id SET NOT NULL;

DO $unique_contract$
DECLARE
  v_couple_id_attnum smallint;
BEGIN
  SELECT attribute.attnum
    INTO v_couple_id_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.wedding_journeys'::regclass
    AND attribute.attname = 'couple_id'
    AND NOT attribute.attisdropped;

  IF v_couple_id_attnum IS NULL THEN
    RAISE EXCEPTION 'WEDDING_JOURNEY_COUPLE_COLUMN_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.wedding_journeys'::regclass
      AND constraint_row.contype IN ('u', 'p')
      AND constraint_row.conkey = ARRAY[v_couple_id_attnum]::smallint[]
  ) THEN
    -- Building the index first uses SHARE rather than holding ACCESS EXCLUSIVE
    -- for the complete index scan. Attaching it as a constraint is metadata-only.
    IF to_regclass('public.wedding_journeys_couple_id_key') IS NULL THEN
      EXECUTE 'CREATE UNIQUE INDEX wedding_journeys_couple_id_key '
        || 'ON public.wedding_journeys (couple_id)';
    END IF;

    ALTER TABLE public.wedding_journeys
      ADD CONSTRAINT wedding_journeys_couple_id_key
      UNIQUE USING INDEX wedding_journeys_couple_id_key;
  END IF;
END
$unique_contract$;

DO $postconditions$
DECLARE
  v_couple_id_attnum smallint;
BEGIN
  SELECT attribute.attnum
    INTO v_couple_id_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.wedding_journeys'::regclass
    AND attribute.attname = 'couple_id'
    AND NOT attribute.attisdropped;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wedding_journeys'
      AND column_name = 'couple_id'
      AND is_nullable <> 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.wedding_journeys'::regclass
      AND constraint_row.contype IN ('u', 'p')
      AND constraint_row.conkey = ARRAY[v_couple_id_attnum]::smallint[]
  ) THEN
    RAISE EXCEPTION 'WEDDING_JOURNEY_SINGLETON_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMENT ON COLUMN public.wedding_journeys.couple_id IS
  'Exactly one durable wedding journey is allowed for each couple.';
