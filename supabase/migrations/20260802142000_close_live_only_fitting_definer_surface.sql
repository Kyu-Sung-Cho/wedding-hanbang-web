-- Remove client execution from legacy fitting maintenance functions discovered
-- in the hosted database. Both functions run as their owner: one deletes rows
-- and the other mutates an arbitrary couple's usage counter. Current app code
-- has no direct client consumer, so execution is reserved for service_role.
--
-- These functions predate the tracked migration baseline in some environments;
-- the fence is therefore conditional while still verifying every function that
-- is present after the privilege change.

BEGIN;

DO $close_live_only_fitting_definers$
DECLARE
  target_signature text;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'public.cleanup_expired_fittings()',
    'public.increment_fitting_usage(uuid,date)'
  ]::text[]
  LOOP
    IF to_regprocedure(target_signature) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      target_signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      target_signature
    );
  END LOOP;
END;
$close_live_only_fitting_definers$;

DO $postflight$
DECLARE
  target_signature text;
  target_role text;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'public.cleanup_expired_fittings()',
    'public.increment_fitting_usage(uuid,date)'
  ]::text[]
  LOOP
    IF to_regprocedure(target_signature) IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
    LOOP
      IF has_function_privilege(target_role, target_signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'FITTING_DEFINER_FENCE_CLIENT_EXECUTE_REMAINS: %.%',
          target_role,
          target_signature
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    IF NOT has_function_privilege(
      'service_role',
      target_signature,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'FITTING_DEFINER_FENCE_SERVICE_EXECUTE_MISSING: %',
        target_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$postflight$;

COMMIT;
