BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
DECLARE
  v_join_definition text;
BEGIN
  IF pg_catalog.to_regclass('public.couples') IS NULL THEN
    RAISE EXCEPTION 'COUPLE_INVITE_NULLABLE_RESTORE_TABLE_MISSING';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.join_couple_invite_core(uuid,text,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'COUPLE_INVITE_NULLABLE_RESTORE_CONSUMER_MISSING';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.couples'::regclass
         AND attname = 'invite_code'
         AND atttypid = 'pg_catalog.text'::regtype
         AND attnum > 0
         AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_NULLABLE_RESTORE_COLUMN_INVALID';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.couples'::regclass
         AND conname = 'couples_invite_lifecycle_valid'
         AND contype = 'c'
         AND convalidated
     ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_NULLABLE_RESTORE_LIFECYCLE_INVALID';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.join_couple_invite_core(uuid,text,text,text)'::regprocedure
  )
    INTO v_join_definition;

  IF v_join_definition !~ 'invite_code[[:space:]]*=[[:space:]]*NULL' THEN
    RAISE EXCEPTION 'COUPLE_INVITE_NULLABLE_RESTORE_CONSUMER_DRIFT';
  END IF;
END;
$preconditions$;

ALTER TABLE public.couples
  ALTER COLUMN invite_code DROP NOT NULL;

DO $postconditions$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.couples'::regclass
         AND attname = 'invite_code'
         AND NOT attnotnull
         AND attnum > 0
         AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.couples'::regclass
         AND conname = 'couples_invite_lifecycle_valid'
         AND contype = 'c'
         AND convalidated
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.couples'::regclass
         AND tgname = 'trg_manage_couple_invite_lifecycle'
         AND tgenabled = 'O'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_NULLABLE_RESTORE_POSTCONDITION_FAILED';
  END IF;
END;
$postconditions$;

COMMENT ON COLUMN public.couples.invite_code IS
  'Nullable after one-time invite redemption; active invites remain guarded by couples_invite_lifecycle_valid.';

COMMIT;
