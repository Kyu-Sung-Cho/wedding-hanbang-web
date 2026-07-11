BEGIN;

SET LOCAL statement_timeout = '30s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_subject_a constant uuid := '10000000-0000-4000-8000-000000000001';
  v_subject_b constant uuid := '10000000-0000-4000-8000-000000000002';
  v_missing_subject constant uuid := '10000000-0000-4000-8000-000000000003';
  v_null_key constant text := 'rl:' || repeat('1', 64);
  v_bound_key constant text := 'rl:' || repeat('2', 64);
  v_missing_key constant text := 'rl:' || repeat('3', 64);
  v_deleting_key constant text := 'rl:' || repeat('4', 64);
  v_compat_key constant text := 'rl:' || repeat('5', 64);
  v_allowed boolean;
  v_rejected boolean;
  v_count integer;
  v_bound_subject uuid;
BEGIN
  INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES
    (v_subject_a, 'rate-limit-a@example.invalid', '{}'::jsonb),
    (v_subject_b, 'rate-limit-b@example.invalid', '{}'::jsonb);

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_subject_a)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_subject_b) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SMOKE_PROFILE_SETUP_FAILED';
  END IF;

  SELECT allowed INTO v_allowed
  FROM public.check_rate_limit(v_null_key, 10, 60000, NULL::uuid);
  IF v_allowed IS DISTINCT FROM true OR EXISTS (
    SELECT 1 FROM public.rate_limit_buckets
    WHERE key = v_null_key AND subject_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_NULL_SUBJECT_CONTRACT_FAILED';
  END IF;

  SELECT allowed INTO v_allowed
  FROM public.check_rate_limit(v_compat_key, 10, 60000);
  IF v_allowed IS DISTINCT FROM true OR EXISTS (
    SELECT 1 FROM public.rate_limit_buckets
    WHERE key = v_compat_key AND subject_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_THREE_ARG_COMPAT_CONTRACT_FAILED';
  END IF;

  SELECT allowed INTO v_allowed
  FROM public.check_rate_limit(v_bound_key, 10, 60000, v_subject_a);
  SELECT allowed INTO v_allowed
  FROM public.check_rate_limit(v_bound_key, 10, 60000);
  SELECT allowed INTO v_allowed
  FROM public.check_rate_limit(v_bound_key, 10, 60000, v_subject_a);
  SELECT bucket.count, bucket.subject_user_id
    INTO v_count, v_bound_subject
  FROM public.rate_limit_buckets AS bucket
  WHERE bucket.key = v_bound_key;
  IF v_allowed IS DISTINCT FROM true OR v_count <> 3
     OR v_bound_subject IS DISTINCT FROM v_subject_a THEN
    RAISE EXCEPTION 'RATE_LIMIT_SAME_SUBJECT_COUNT_CONTRACT_FAILED';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM *
    FROM public.check_rate_limit(v_bound_key, 10, 60000, v_subject_b);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'RATE_LIMIT_DIFFERENT_SUBJECT_WAS_NOT_REJECTED';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM *
    FROM public.check_rate_limit(v_missing_key, 10, 60000, v_missing_subject);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'RATE_LIMIT_MISSING_SUBJECT_WAS_NOT_REJECTED';
  END IF;

  UPDATE public.profiles
  SET account_deleting_at = now()
  WHERE id = v_subject_b;
  v_rejected := false;
  BEGIN
    PERFORM *
    FROM public.check_rate_limit(v_deleting_key, 10, 60000, v_subject_b);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'RATE_LIMIT_DELETING_SUBJECT_WAS_NOT_REJECTED';
  END IF;

  DELETE FROM public.profiles WHERE id = v_subject_a;
  IF EXISTS (SELECT 1 FROM public.rate_limit_buckets WHERE key = v_bound_key) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SUBJECT_DELETE_DID_NOT_CASCADE';
  END IF;
END;
$$;

ROLLBACK;
