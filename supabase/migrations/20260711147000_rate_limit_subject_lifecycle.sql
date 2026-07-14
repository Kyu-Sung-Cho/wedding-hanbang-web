
SET lock_timeout = '5s';
SET statement_timeout = '90s';

-- Protected rate-limit keys are HMAC digests, so a raw UUID suffix cannot be
-- recovered during account deletion. Store the authenticated subject as a
-- separate nullable lifecycle reference. Existing opaque rows stay anonymous
-- and expire through the reviewed retention job; inventing a backfill would
-- risk attaching an email/IP bucket to the wrong account.
ALTER TABLE public.rate_limit_buckets
  ADD COLUMN IF NOT EXISTS subject_user_id uuid;

ALTER TABLE public.rate_limit_buckets
  DROP CONSTRAINT IF EXISTS rate_limit_buckets_subject_user_id_fkey;
ALTER TABLE public.rate_limit_buckets
  ADD CONSTRAINT rate_limit_buckets_subject_user_id_fkey
  FOREIGN KEY (subject_user_id)
  REFERENCES public.profiles(id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_subject_user_id
  ON public.rate_limit_buckets(subject_user_id)
  WHERE subject_user_id IS NOT NULL;

-- Keep a trigger as defense in depth for owner-side maintenance and the
-- SECURITY DEFINER writer. The canonical RPC already owns the required
-- profile -> bucket lock order; direct service-role INSERT/UPDATE is revoked
-- below so a future PostgREST caller cannot invert that order.
CREATE OR REPLACE FUNCTION public.guard_account_deletion_rate_limit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleting_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.subject_user_id IS NOT NULL
    AND NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
  THEN
    RAISE EXCEPTION 'rate limit subject binding is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.subject_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_deleting_at INTO v_deleting_at
  FROM public.profiles
  WHERE id = NEW.subject_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'referenced account is not active'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_account_deletion_rate_limit_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_account_deletion_rate_limit_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_delete_rate_limit_buckets
  ON public.rate_limit_buckets;
CREATE TRIGGER guard_delete_rate_limit_buckets
  BEFORE INSERT OR UPDATE ON public.rate_limit_buckets
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_rate_limit_write();

-- The four-argument overload is the canonical writer. It keeps the reviewed
-- service-role/key/limit validation from 111450, locks an authenticated subject
-- before the bucket, binds NULL -> subject atomically, and rejects a different
-- non-NULL subject for the same opaque key.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_max_requests integer,
  p_window_ms integer,
  p_subject_user_id uuid
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
  v_stored_subject_user_id uuid;
  v_lock_subject_user_id uuid;
  v_account_deleting_at timestamptz;
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

  -- Every bound-bucket path must acquire locks in profile -> bucket order,
  -- matching account deletion. A NULL caller may be a rolling three-argument
  -- server, so discover an existing binding without taking the bucket lock.
  v_lock_subject_user_id := p_subject_user_id;
  IF v_lock_subject_user_id IS NULL THEN
    SELECT bucket.subject_user_id INTO v_lock_subject_user_id
    FROM public.rate_limit_buckets AS bucket
    WHERE bucket.key = p_key;
  END IF;

  IF v_lock_subject_user_id IS NOT NULL THEN
    SELECT account_deleting_at INTO v_account_deleting_at
    FROM public.profiles
    WHERE id = v_lock_subject_user_id
    FOR UPDATE;

    IF NOT FOUND OR v_account_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'referenced account is not active'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.rate_limit_buckets(
    key, count, reset_at, updated_at, subject_user_id
  )
  VALUES (
    p_key, 0, v_now + make_interval(secs => v_window_seconds), v_now,
    p_subject_user_id
  )
  ON CONFLICT (key) DO NOTHING;

  SELECT count, reset_at, subject_user_id
    INTO v_count, v_reset_at, v_stored_subject_user_id
    FROM public.rate_limit_buckets
    WHERE key = p_key
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rate limit bucket was not created'
      USING ERRCODE = '55000';
  END IF;

  -- A NULL caller can race a new authenticated binding between the unlocked
  -- discovery read and the bucket lock. Never invert the lock order in that
  -- case; make the narrow request retry/fallback without mutating the row.
  IF p_subject_user_id IS NULL
     AND v_stored_subject_user_id IS NOT NULL
     AND v_stored_subject_user_id IS DISTINCT FROM v_lock_subject_user_id THEN
    RAISE EXCEPTION 'rate limit subject changed; retry'
      USING ERRCODE = '40001';
  END IF;

  IF p_subject_user_id IS NOT NULL THEN
    IF v_stored_subject_user_id IS NULL THEN
      UPDATE public.rate_limit_buckets
      SET subject_user_id = p_subject_user_id,
          updated_at = v_now
      WHERE key = p_key
        AND subject_user_id IS NULL;
      v_stored_subject_user_id := p_subject_user_id;
    ELSIF v_stored_subject_user_id IS DISTINCT FROM p_subject_user_id THEN
      RAISE EXCEPTION 'rate limit subject mismatch'
        USING ERRCODE = '22023';
    END IF;
  END IF;

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

-- Rolling servers still send the reviewed three-argument shape. They make no
-- new subject claim, but preserve an existing binding by discovering it before
-- the canonical writer acquires the profile -> bucket locks. Missing/unbound
-- legacy rows still delegate as NULL and expire through retention.
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
  v_existing_subject_user_id uuid;
BEGIN
  SELECT bucket.subject_user_id INTO v_existing_subject_user_id
  FROM public.rate_limit_buckets AS bucket
  WHERE bucket.key = p_key;

  RETURN QUERY
  SELECT result.allowed, result.retry_after_seconds
  FROM public.check_rate_limit(
    p_key,
    p_max_requests,
    p_window_ms,
    v_existing_subject_user_id
  ) AS result;
END;
$$;

ALTER FUNCTION public.check_rate_limit(text, integer, integer, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.check_rate_limit(text, integer, integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer)
  TO service_role;

-- All count/binding mutations must use check_rate_limit(). The account
-- deletion worker still needs a narrowly scoped direct DELETE, and operational
-- health may read rows. Remove both table- and column-level mutation grants so
-- a future service client cannot acquire bucket -> profile locks through the
-- trigger and deadlock against account deletion's profile -> bucket order.
REVOKE ALL PRIVILEGES ON TABLE public.rate_limit_buckets
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT (key, count, reset_at, updated_at, subject_user_id)
  ON TABLE public.rate_limit_buckets
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE UPDATE (key, count, reset_at, updated_at, subject_user_id)
  ON TABLE public.rate_limit_buckets
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE REFERENCES (key, count, reset_at, updated_at, subject_user_id)
  ON TABLE public.rate_limit_buckets
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.rate_limit_buckets TO service_role;

COMMENT ON COLUMN public.rate_limit_buckets.subject_user_id IS
  'Authenticated subject lifecycle link. NULL is required for IP/email/anonymous limiters; opaque keys never contain recoverable identifiers.';
COMMENT ON FUNCTION public.check_rate_limit(text, integer, integer, uuid) IS
  'Canonical service-only rate limiter. Atomically binds an optional authenticated subject for account-deletion cleanup.';
COMMENT ON FUNCTION public.check_rate_limit(text, integer, integer) IS
  'Rolling compatibility wrapper. New authenticated callers must use the four-argument overload.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute attribute_row
    WHERE attribute_row.attrelid = to_regclass('public.rate_limit_buckets')
      AND attribute_row.attname = 'subject_user_id'
      AND attribute_row.atttypid = 'uuid'::regtype
      AND NOT attribute_row.attnotnull
      AND NOT attribute_row.atthasdef
      AND attribute_row.attidentity = ''
      AND attribute_row.attgenerated = ''
      AND NOT attribute_row.attisdropped
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SUBJECT_COLUMN_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_row
    WHERE constraint_row.conrelid = to_regclass('public.rate_limit_buckets')
      AND constraint_row.conname = 'rate_limit_buckets_subject_user_id_fkey'
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = to_regclass('public.profiles')
      AND constraint_row.confdeltype = 'c'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid, true) =
        'FOREIGN KEY (subject_user_id) REFERENCES profiles(id) ON DELETE CASCADE'
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SUBJECT_FK_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes index_row
    WHERE index_row.schemaname = 'public'
      AND index_row.tablename = 'rate_limit_buckets'
      AND index_row.indexname = 'idx_rate_limit_buckets_subject_user_id'
      AND index_row.indexdef =
        'CREATE INDEX idx_rate_limit_buckets_subject_user_id ON public.rate_limit_buckets USING btree (subject_user_id) WHERE (subject_user_id IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SUBJECT_INDEX_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = to_regclass('public.rate_limit_buckets')
      AND trigger_row.tgname = 'guard_delete_rate_limit_buckets'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgfoid =
        to_regprocedure('public.guard_account_deletion_rate_limit_write()')
      AND pg_get_triggerdef(trigger_row.oid, true) =
        'CREATE TRIGGER guard_delete_rate_limit_buckets BEFORE INSERT OR UPDATE ON rate_limit_buckets FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_rate_limit_write()'
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SUBJECT_TRIGGER_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure_row
    WHERE procedure_row.oid =
        to_regprocedure('public.check_rate_limit(text,integer,integer,uuid)')
      AND pg_get_function_result(procedure_row.oid) =
        'TABLE(allowed boolean, retry_after_seconds integer)'
      AND procedure_row.prosecdef
      AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig @> ARRAY['search_path=public']::text[]
      AND md5(replace(procedure_row.prosrc, chr(13), '')) =
        '7583f22c1daf9cebea4f7a847a6a507f'
      AND procedure_row.proargnames = ARRAY[
        'p_key', 'p_max_requests', 'p_window_ms', 'p_subject_user_id',
        'allowed', 'retry_after_seconds'
      ]::text[]
      AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SUBJECT_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure_row
    WHERE procedure_row.oid =
        to_regprocedure('public.check_rate_limit(text,integer,integer)')
      AND pg_get_function_result(procedure_row.oid) =
        'TABLE(allowed boolean, retry_after_seconds integer)'
      AND procedure_row.prosecdef
      AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig @> ARRAY['search_path=public']::text[]
      AND md5(replace(procedure_row.prosrc, chr(13), '')) =
        'dbaddace99dcf6ddbe99da5eefe0797a'
      AND procedure_row.proargnames = ARRAY[
        'p_key', 'p_max_requests', 'p_window_ms',
        'allowed', 'retry_after_seconds'
      ]::text[]
      AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_COMPAT_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure_row
    WHERE procedure_row.oid =
        to_regprocedure('public.guard_account_deletion_rate_limit_write()')
      AND pg_get_function_result(procedure_row.oid) = 'trigger'
      AND procedure_row.prosecdef
      AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig @>
        ARRAY['search_path=public, pg_temp']::text[]
      AND md5(replace(procedure_row.prosrc, chr(13), '')) =
        'b8ebd5bbf8df5b250d36404f4d6f0a5c'
      AND procedure_row.proargnames IS NULL
      AND NOT has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_SUBJECT_GUARD_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_table_privilege(
      'service_role', 'public.rate_limit_buckets', 'SELECT'
    )
    OR NOT has_table_privilege(
      'service_role', 'public.rate_limit_buckets', 'DELETE'
    )
    OR has_table_privilege(
      'service_role', 'public.rate_limit_buckets', 'INSERT'
    )
    OR has_any_column_privilege(
      'service_role', 'public.rate_limit_buckets', 'INSERT'
    )
    OR has_table_privilege(
      'service_role', 'public.rate_limit_buckets', 'UPDATE'
    )
    OR has_any_column_privilege(
      'service_role', 'public.rate_limit_buckets', 'UPDATE'
    )
    OR has_table_privilege(
      'service_role', 'public.rate_limit_buckets', 'TRUNCATE'
    )
    OR has_table_privilege(
      'service_role', 'public.rate_limit_buckets', 'REFERENCES'
    )
    OR has_any_column_privilege(
      'service_role', 'public.rate_limit_buckets', 'REFERENCES'
    )
    OR has_table_privilege(
      'service_role', 'public.rate_limit_buckets', 'TRIGGER'
    )
  THEN
    RAISE EXCEPTION 'RATE_LIMIT_TABLE_ACL_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
