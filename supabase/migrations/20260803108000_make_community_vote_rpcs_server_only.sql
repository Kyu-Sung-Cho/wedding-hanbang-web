-- Route-level durable rate limits are security boundaries, not UI hints.
-- Native clients historically called the vote RPCs directly, allowing an
-- authenticated account to generate unbounded row locks and WAL while simply
-- toggling the same vote. Current web and mobile clients now use the API
-- routes, whose service-owned calls are durably limited. Remove the bypass.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  signature text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_SERVER_BOUNDARY_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  FOREACH signature IN ARRAY ARRAY[
    'public.community_vote_post(uuid,uuid,smallint)',
    'public.community_vote_comment(uuid,uuid,smallint)',
    'public.community_record_login(uuid)'
  ]::text[]
  LOOP
    IF pg_catalog.to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_VOTE_SERVER_BOUNDARY_FUNCTION_MISSING: %', signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$preflight$;

REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_record_login(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.community_vote_post(uuid, uuid, smallint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_vote_comment(uuid, uuid, smallint)
  TO service_role;

DO $postcondition$
DECLARE
  signature text;
  procedure_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.community_vote_post(uuid,uuid,smallint)',
    'public.community_vote_comment(uuid,uuid,smallint)'
  ]::text[]
  LOOP
    SELECT * INTO procedure_record
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = pg_catalog.to_regprocedure(signature);

    IF NOT FOUND
       OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR procedure_record.prosecdef IS NOT TRUE
       OR procedure_record.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'COMMUNITY_VOTE_SERVER_BOUNDARY_INVALID: %', signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.community_record_login(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.community_record_login(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.community_record_login(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'DORMANT_COMMUNITY_LOGIN_RPC_REMAINS_CALLABLE'
      USING ERRCODE = '55000';
  END IF;
END;
$postcondition$;

COMMENT ON FUNCTION public.community_vote_post(uuid, uuid, smallint) IS
  'Server-only vote mutation. Call through the authenticated, durably rate-limited API route.';
COMMENT ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) IS
  'Server-only vote mutation. Call through the authenticated, durably rate-limited API route.';
COMMENT ON FUNCTION public.community_record_login(uuid) IS
  'Dormant legacy gamification RPC; execution is disabled for all API roles.';

COMMIT;
