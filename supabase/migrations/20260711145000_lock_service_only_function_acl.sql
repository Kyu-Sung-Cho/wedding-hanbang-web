
SET lock_timeout = '5s';
SET statement_timeout = '90s';

-- This RPC mutates the shared rate-limit ledger and is called only through the
-- server-side service client. Enforce that trust boundary in both ACL and body,
-- and accept only the opaque HMAC/SHA-256 key shape emitted by rateLimit.ts.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_max_requests integer,
  p_window_ms integer
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_reset_at timestamptz;
  v_count integer;
  v_window_seconds integer := GREATEST(1, CEIL(p_window_ms / 1000.0)::integer);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF p_key IS NULL OR p_key !~ '^rl:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid protected rate limit key' USING ERRCODE = '22023';
  END IF;

  IF p_max_requests IS NULL OR p_window_ms IS NULL
     OR p_max_requests < 1 OR p_window_ms < 1000 THEN
    RETURN QUERY SELECT false, v_window_seconds;
    RETURN;
  END IF;

  INSERT INTO public.rate_limit_buckets(key, count, reset_at, updated_at)
  VALUES (p_key, 0, v_now + make_interval(secs => v_window_seconds), v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT count, reset_at
    INTO v_count, v_reset_at
    FROM public.rate_limit_buckets
    WHERE key = p_key
    FOR UPDATE;

  IF v_reset_at <= v_now THEN
    UPDATE public.rate_limit_buckets
      SET count = 1,
          reset_at = v_now + make_interval(secs => v_window_seconds),
          updated_at = v_now
      WHERE key = p_key;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  IF v_count >= p_max_requests THEN
    RETURN QUERY SELECT
      false,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset_at - v_now)))::integer);
    RETURN;
  END IF;

  UPDATE public.rate_limit_buckets
    SET count = count + 1,
        updated_at = v_now
    WHERE key = p_key;

  RETURN QUERY SELECT true, 0;
END;
$$;

-- Reinstall the reviewed retention sources so legacy PUBLIC grants cannot
-- survive CREATE OR REPLACE semantics on an already-migrated environment.
CREATE OR REPLACE FUNCTION public.redact_old_ai_interactions(
  p_retention interval DEFAULT interval '90 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE ai_interactions_log
  SET
    user_id = NULL,
    couple_id = NULL,
    session_id = NULL,
    message_id = NULL,
    user_input = CASE WHEN user_input IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    ai_output = CASE WHEN ai_output IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN error_message IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', metadata->>'visibility',
      'endpoint', metadata->>'endpoint',
      'source', metadata->>'source',
      'quota_class', metadata->>'quota_class',
      'request_usage', metadata->'request_usage',
      'retention_redacted_at', now(),
      'retention_policy', 'raw_payload_and_identifiers_90d'
    ))
  WHERE created_at < now() - p_retention
    AND COALESCE(metadata->>'retention_policy', '') <> 'raw_payload_and_identifiers_90d';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_ai_interaction_retention()
RETURNS TABLE(redacted integer, deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redacted integer;
  v_deleted integer;
BEGIN
  SELECT redact_old_ai_interactions(interval '90 days') INTO v_redacted;

  -- Feedback corrections can contain a verbatim user message even though they
  -- are outside ai_interactions_log. Remove payload and identifiers on the same horizon.
  UPDATE chat_feedback
  SET user_id = NULL,
      couple_id = NULL,
      message_id = NULL,
      correction = NULL,
      message_content = NULL
  WHERE created_at < now() - interval '90 days'
    AND (user_id IS NOT NULL OR couple_id IS NOT NULL OR message_id IS NOT NULL
      OR correction IS NOT NULL OR message_content IS NOT NULL);

  DELETE FROM ai_interactions_log WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM chat_feedback WHERE created_at < now() - interval '1 year';
  RETURN QUERY SELECT v_redacted, v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_application_survey_retention()
RETURNS TABLE(preregistrations_deleted integer, survey_responses_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prereg integer;
  v_survey integer;
BEGIN
  DELETE FROM public.preregistrations
  WHERE expires_at <= now();
  GET DIAGNOSTICS v_prereg = ROW_COUNT;

  DELETE FROM public.customer_survey_responses
  WHERE expires_at <= now();
  GET DIAGNOSTICS v_survey = ROW_COUNT;

  RETURN QUERY SELECT v_prereg, v_survey;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_expired_rate_limit_buckets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_buckets
  WHERE reset_at < now() - interval '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.check_rate_limit(text, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.redact_old_ai_interactions(interval) OWNER TO postgres;
ALTER FUNCTION public.enforce_ai_interaction_retention() OWNER TO postgres;
ALTER FUNCTION public.enforce_application_survey_retention() OWNER TO postgres;
ALTER FUNCTION public.delete_expired_rate_limit_buckets() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_old_ai_interactions(interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_ai_interaction_retention()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_application_survey_retention()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_expired_rate_limit_buckets()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_ai_interaction_retention()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_application_survey_retention()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_expired_rate_limit_buckets()
  TO service_role;

-- Production and the historical replay differ only in formatting for this
-- trigger body. Reinstall one explicit canonical definition so exact source
-- contracts converge instead of inheriting whichever version happened to be
-- present before this migration.
CREATE OR REPLACE FUNCTION public.create_profile_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, name, email, onboarding_completed, onboarding_step, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, ''), '@', 1), 'User'),
    NEW.email, false, 0, NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, profiles.email),
    name = COALESCE(EXCLUDED.name, profiles.name),
    updated_at = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'create_profile_on_signup failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Trigger functions are invoked by their bound triggers and have no supported
-- RPC surface. Remove inherited client execution and pin every definer search
-- path; trigger execution itself does not depend on callers having EXECUTE.
ALTER FUNCTION public.community_recalc_rank() OWNER TO postgres;
ALTER FUNCTION public.community_recalc_rank() SET search_path = public;
ALTER FUNCTION public.create_profile_on_signup() OWNER TO postgres;
ALTER FUNCTION public.create_profile_on_signup() SET search_path = public;
ALTER FUNCTION public.guard_amora_user_message_insert() OWNER TO postgres;
ALTER FUNCTION public.guard_amora_user_message_insert() SET search_path = public;
ALTER FUNCTION public.guard_profile_self_insert() OWNER TO postgres;
ALTER FUNCTION public.guard_profile_self_insert() SET search_path = public;
ALTER FUNCTION public.prevent_cohort_membership_client_write() OWNER TO postgres;
ALTER FUNCTION public.prevent_cohort_membership_client_write() SET search_path = public;
ALTER FUNCTION public.prevent_couple_ownership_self_change() OWNER TO postgres;
ALTER FUNCTION public.prevent_couple_ownership_self_change() SET search_path = public;
ALTER FUNCTION public.prevent_couple_slot_self_change() OWNER TO postgres;
ALTER FUNCTION public.prevent_couple_slot_self_change() SET search_path = public;
ALTER FUNCTION public.prevent_is_admin_self_change() OWNER TO postgres;
ALTER FUNCTION public.prevent_is_admin_self_change() SET search_path = public;

REVOKE ALL ON FUNCTION public.community_recalc_rank()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_profile_on_signup()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_amora_user_message_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_self_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_cohort_membership_client_write()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_couple_ownership_self_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_couple_slot_self_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_is_admin_self_change()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.community_recalc_rank() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_profile_on_signup() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_amora_user_message_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_profile_self_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_cohort_membership_client_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_couple_ownership_self_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_couple_slot_self_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_is_admin_self_change() TO service_role;

DO $$
DECLARE
  v_contract record;
BEGIN
  FOR v_contract IN
    SELECT *
    FROM (VALUES
      ('public.check_rate_limit(text,integer,integer)',
        'TABLE(allowed boolean, retry_after_seconds integer)',
        '533a53dbb36455bafb743070bcf6644b',
        ARRAY['p_key', 'p_max_requests', 'p_window_ms',
          'allowed', 'retry_after_seconds']::text[]),
      ('public.redact_old_ai_interactions(interval)', 'integer',
        '571f7b3674ee36b941bb19064f8b1cb0', ARRAY['p_retention']::text[]),
      ('public.enforce_ai_interaction_retention()',
        'TABLE(redacted integer, deleted integer)',
        '85cb9b5ccafca3cca9b3cdf74ee4eddc', ARRAY['redacted', 'deleted']::text[]),
      ('public.enforce_application_survey_retention()',
        'TABLE(preregistrations_deleted integer, survey_responses_deleted integer)',
        'bfd5bc045ed108c9d06eadbaa8493459',
        ARRAY['preregistrations_deleted', 'survey_responses_deleted']::text[]),
      ('public.delete_expired_rate_limit_buckets()', 'integer',
        '667f711d08313c214c99cf4a8023b513', NULL::text[])
    ) expected(signature, expected_result, expected_source_md5, expected_arg_names)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc procedure_row
      WHERE procedure_row.oid = to_regprocedure(v_contract.signature)
        AND pg_get_function_result(procedure_row.oid) = v_contract.expected_result
        AND procedure_row.prosecdef
        AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
        AND procedure_row.proconfig @> ARRAY['search_path=public']::text[]
        AND md5(replace(procedure_row.prosrc, chr(13), '')) =
          v_contract.expected_source_md5
        AND procedure_row.proargnames IS NOT DISTINCT FROM v_contract.expected_arg_names
        AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'SERVICE_FUNCTION_CONTRACT_MISMATCH: %', v_contract.signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOR v_contract IN
    SELECT *
    FROM (VALUES
      ('public.community_recalc_rank()', 'c742d9e87a9c815491d03c574690772c'),
      ('public.create_profile_on_signup()', '84a6f9f7f2c366bb87703fcc25cc2f22'),
      ('public.guard_amora_user_message_insert()', '3b3a72bfb77bfd27a0b7f43b718cb4c0'),
      ('public.guard_profile_self_insert()', 'e1a79bcb72eb8b1df1c5edb70f181e44'),
      ('public.prevent_cohort_membership_client_write()', '5947d166102367678683a8ae71c2b72d'),
      ('public.prevent_couple_ownership_self_change()', '697c40535a23d739a271b0b4e3b2ffbf'),
      ('public.prevent_couple_slot_self_change()', 'c795f37d371b8143d50b45d65de96411'),
      ('public.prevent_is_admin_self_change()', '9395ea55bfc5192e10ef000e0421d7b3')
    ) expected(signature, expected_source_md5)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc procedure_row
      WHERE procedure_row.oid = to_regprocedure(v_contract.signature)
        AND pg_get_function_result(procedure_row.oid) = 'trigger'
        AND procedure_row.prosecdef
        AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
        AND procedure_row.proconfig @> ARRAY['search_path=public']::text[]
        AND md5(replace(procedure_row.prosrc, chr(13), '')) =
          v_contract.expected_source_md5
        AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'TRIGGER_FUNCTION_ACL_CONTRACT_MISMATCH: %', v_contract.signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('enforce-ai-interaction-retention', '17 18 * * *',
        'SELECT public.enforce_ai_interaction_retention();'),
      ('enforce-application-survey-retention', '41 18 * * *',
        'SELECT public.enforce_application_survey_retention();'),
      ('delete-expired-rate-limit-buckets', '47 18 * * *',
        'SELECT public.delete_expired_rate_limit_buckets();')
    ) expected(job_name, schedule, command)
    LEFT JOIN cron.job job_row ON job_row.jobname = expected.job_name
    GROUP BY expected.job_name, expected.schedule, expected.command
    HAVING count(job_row.jobid) <> 1
       OR NOT bool_and(
         job_row.schedule = expected.schedule
         AND job_row.command = expected.command
         AND job_row.active
       )
  ) THEN
    RAISE EXCEPTION 'RETENTION_MAINTENANCE_CRON_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
