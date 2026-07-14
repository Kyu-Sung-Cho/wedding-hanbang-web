
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Trigger guards execute through their bound triggers. They are not RPCs and
-- no client or service worker needs direct EXECUTE. Reinstall the reviewed
-- source and make the direct-call denial explicit for both fresh and already
-- migrated environments.
CREATE OR REPLACE FUNCTION public.guard_account_deletion_user_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_user_text text;
  v_deleting_at timestamptz;
BEGIN
  IF TG_NARGS <> 1 THEN
    RAISE EXCEPTION 'account deletion guard column is required' USING ERRCODE = '22023';
  END IF;
  v_user_text := to_jsonb(NEW)->>TG_ARGV[0];
  IF v_user_text IS NULL OR btrim(v_user_text) = '' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_user_id := v_user_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid guarded user reference' USING ERRCODE = '22023';
  END;

  SELECT account_deleting_at INTO v_deleting_at
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'referenced account is not active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_account_deletion_rate_limit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_text text;
  v_user_id uuid;
  v_deleting_at timestamptz;
BEGIN
  v_user_text := right(NEW.key, 36);
  IF NEW.key !~ ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;
  v_user_id := v_user_text::uuid;
  SELECT account_deleting_at INTO v_deleting_at
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'referenced account is not active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_expired_amora_request_claims()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.amora_provider_leases WHERE expires_at <= now();
  DELETE FROM public.amora_request_claims WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION public.guard_account_deletion_user_reference() OWNER TO postgres;
ALTER FUNCTION public.guard_account_deletion_rate_limit_write() OWNER TO postgres;
ALTER FUNCTION public.delete_expired_amora_request_claims() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.guard_account_deletion_user_reference()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_account_deletion_rate_limit_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_expired_amora_request_claims()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expired_amora_request_claims()
  TO service_role;

DO $$
DECLARE
  v_expected record;
  v_function_oid oid;
  v_result text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_source_md5 text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      (
        'public.guard_account_deletion_user_reference()',
        '0518d47d1da58e822a8b6ba662bd06eb'
      ),
      (
        'public.guard_account_deletion_rate_limit_write()',
        '6f78ae5968446ee2f94e53d2573d4d29'
      )
    ) expected(signature, source_md5)
  LOOP
    v_function_oid := to_regprocedure(v_expected.signature);
    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_TRIGGER_GUARD_MISSING: %',
        v_expected.signature USING ERRCODE = '55000';
    END IF;

    SELECT pg_get_function_result(function_row.oid),
           pg_get_userbyid(function_row.proowner),
           function_row.prosecdef,
           function_row.proconfig,
           md5(replace(function_row.prosrc, chr(13), ''))
    INTO v_result, v_owner, v_security_definer, v_config, v_source_md5
    FROM pg_catalog.pg_proc function_row
    WHERE function_row.oid = v_function_oid;

    IF v_result <> 'trigger'
      OR v_owner <> 'postgres'
      OR NOT v_security_definer
      OR NOT v_config @> ARRAY['search_path=public, pg_temp']::text[]
      OR v_source_md5 <> v_expected.source_md5
      OR has_function_privilege('service_role', v_function_oid, 'EXECUTE')
      OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
      OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_TRIGGER_GUARD_CONTRACT_MISMATCH: %',
        v_expected.signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_expected record;
  v_function_oid oid;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      (
        'public.account_deletion_queue_health()',
        'jsonb',
        'search_path=public, pg_temp',
        'b0184ebdb2888d329ef714726d7f76f6'
      ),
      (
        'public.requeue_dead_account_deletion_job(uuid)',
        'boolean',
        'search_path=public, pg_temp',
        '29fe1226857032d271e78f585f887956'
      ),
      (
        'public.delete_expired_amora_request_claims()',
        'integer',
        'search_path=public',
        'dce4955b686ff0f1386e1d9460324758'
      )
    ) expected(signature, result_type, search_path, source_md5)
  LOOP
    v_function_oid := to_regprocedure(v_expected.signature);
    IF v_function_oid IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc function_row
      WHERE function_row.oid = v_function_oid
        AND pg_get_function_result(function_row.oid) = v_expected.result_type
        AND pg_get_userbyid(function_row.proowner) = 'postgres'
        AND function_row.prosecdef
        AND function_row.proconfig @> ARRAY[v_expected.search_path]::text[]
        AND md5(replace(function_row.prosrc, chr(13), '')) =
          v_expected.source_md5
        AND has_function_privilege('service_role', function_row.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', function_row.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_QUEUE_FUNCTION_CONTRACT_MISMATCH: %',
        v_expected.signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('id', 'uuid', true, 'gen_random_uuid()'),
      ('user_id', 'uuid', false, NULL::text),
      ('reason', 'text', true, '''unknown''::text'),
      ('status', 'text', true, '''pending''::text'),
      ('attempts', 'integer', true, '0'),
      ('next_attempt_at', 'timestamp with time zone', false, NULL::text),
      ('lock_token', 'uuid', false, NULL::text),
      ('locked_until', 'timestamp with time zone', false, NULL::text),
      ('storage_inventory', 'jsonb', false, NULL::text),
      ('last_error_code', 'text', false, NULL::text),
      ('last_attempt_at', 'timestamp with time zone', false, NULL::text),
      ('dead_lettered_at', 'timestamp with time zone', false, NULL::text),
      ('completed_at', 'timestamp with time zone', false, NULL::text),
      ('created_at', 'timestamp with time zone', true, 'now()'),
      ('updated_at', 'timestamp with time zone', true, 'now()')
    ) expected(column_name, data_type, not_null, expected_default)
    LEFT JOIN pg_catalog.pg_attribute attribute_row
      ON attribute_row.attrelid = to_regclass('public.account_deletion_jobs')
     AND attribute_row.attname = expected.column_name
     AND attribute_row.attnum > 0
     AND NOT attribute_row.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef default_row
      ON default_row.adrelid = attribute_row.attrelid
     AND default_row.adnum = attribute_row.attnum
    WHERE attribute_row.attname IS NULL
       OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
         IS DISTINCT FROM expected.data_type
       OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
       OR (
         expected.expected_default IS NOT NULL
         AND pg_get_expr(default_row.adbin, default_row.adrelid)
           IS DISTINCT FROM expected.expected_default
       )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_JOB_COLUMN_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.account_deletion_jobs')
        AND constraint_row.conname = 'account_deletion_jobs_pkey'
        AND constraint_row.convalidated
        AND pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY (id)'
    ) OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('account_deletion_jobs_user_id_key', 'UNIQUE (user_id)'),
        ('account_deletion_jobs_reason_check',
          'CHECK (reason = ANY (ARRAY[''unsatisfied''::text, ''alternative''::text, ''wedding_done''::text, ''privacy''::text, ''low_usage''::text, ''other''::text, ''unknown''::text]))'),
        ('account_deletion_jobs_status_check',
          'CHECK (status = ANY (ARRAY[''pending''::text, ''processing''::text, ''retry''::text, ''dead_letter''::text, ''completed''::text]))'),
        ('account_deletion_jobs_attempts_check', 'CHECK (attempts >= 0 AND attempts <= 8)'),
        ('account_deletion_jobs_check',
          'CHECK ((status = ''completed''::text) = (completed_at IS NOT NULL))'),
        ('account_deletion_jobs_check1',
          'CHECK (status <> ''completed''::text OR user_id IS NULL)'),
        ('account_deletion_jobs_check2',
          'CHECK (status <> ''processing''::text OR lock_token IS NOT NULL AND locked_until IS NOT NULL)'),
        ('account_deletion_jobs_check3',
          'CHECK (status = ''processing''::text OR lock_token IS NULL AND locked_until IS NULL)'),
        ('account_deletion_jobs_last_error_code_check',
          'CHECK (last_error_code IS NULL OR last_error_code ~ ''^[A-Z0-9_]{1,64}$''::text)'),
        ('account_deletion_jobs_storage_inventory_check',
          'CHECK (storage_inventory IS NULL OR jsonb_typeof(storage_inventory) = ''array''::text)')
      ) expected(constraint_name, expected_definition)
      LEFT JOIN pg_catalog.pg_constraint constraint_row
        ON constraint_row.conrelid = to_regclass('public.account_deletion_jobs')
       AND constraint_row.conname = expected.constraint_name
      WHERE constraint_row.oid IS NULL
         OR NOT constraint_row.convalidated
         OR pg_get_constraintdef(constraint_row.oid, true)
           IS DISTINCT FROM expected.expected_definition
    )
  THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_JOB_CONSTRAINT_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('account_deletion_jobs_due_idx',
        'CREATE INDEX account_deletion_jobs_due_idx ON public.account_deletion_jobs USING btree (next_attempt_at, created_at) WHERE (status = ANY (ARRAY[''pending''::text, ''retry''::text]))'),
      ('account_deletion_jobs_stale_lock_idx',
        'CREATE INDEX account_deletion_jobs_stale_lock_idx ON public.account_deletion_jobs USING btree (locked_until) WHERE (status = ''processing''::text)'),
      ('account_deletion_jobs_dead_letter_idx',
        'CREATE INDEX account_deletion_jobs_dead_letter_idx ON public.account_deletion_jobs USING btree (dead_lettered_at DESC) WHERE (status = ''dead_letter''::text)')
    ) expected(index_name, expected_definition)
    LEFT JOIN pg_catalog.pg_class index_class
      ON index_class.relnamespace = 'public'::regnamespace
     AND index_class.relname = expected.index_name
    LEFT JOIN pg_catalog.pg_index index_row ON index_row.indexrelid = index_class.oid
    WHERE index_class.oid IS NULL
       OR NOT index_row.indisvalid
       OR NOT index_row.indisready
       OR pg_get_indexdef(index_class.oid)
         IS DISTINCT FROM expected.expected_definition
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_JOB_INDEX_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('delete-expired-amora-request-claims', '29 18 * * *',
        'SELECT public.delete_expired_amora_request_claims();'),
      ('reconcile-stale-amora-chat-requests', '*/5 * * * *',
        'SELECT public.reconcile_stale_amora_chat_requests(100);')
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
    RAISE EXCEPTION 'AMORA_MAINTENANCE_CRON_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
