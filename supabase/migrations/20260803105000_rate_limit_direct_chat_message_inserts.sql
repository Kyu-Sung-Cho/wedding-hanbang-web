-- Bound the authenticated Supabase INSERT path used by the native chat UI.
-- API routes already use the shared rate-limit service, but an authenticated
-- client can legitimately insert its own user message directly under RLS.
-- Keep that path while preventing database/Realtime amplification. Bucket
-- subjects are domain-separated SHA-256 digests of random auth UUIDs; raw
-- account identifiers and message content never enter the limiter table.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  missing_prerequisite text;
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
    RAISE EXCEPTION 'DIRECT_CHAT_RATE_LIMIT_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name)
  INTO missing_prerequisite
  FROM (VALUES
    ('chat_messages', 'id'),
    ('chat_messages', 'sender_id'),
    ('chat_messages', 'role'),
    ('rate_limit_buckets', 'key'),
    ('rate_limit_buckets', 'count'),
    ('rate_limit_buckets', 'reset_at'),
    ('rate_limit_buckets', 'updated_at')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL
  LIMIT 1;

  IF missing_prerequisite IS NOT NULL
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('auth.role()') IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'DIRECT_CHAT_RATE_LIMIT_PREREQUISITE_MISSING: %',
      COALESCE(missing_prerequisite, 'auth or digest boundary')
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

LOCK TABLE public.chat_messages, public.rate_limit_buckets
  IN SHARE ROW EXCLUSIVE MODE;

-- This internal table contains security state only and should stay closed even
-- if its owner is used through an accidental non-superuser connection.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.rate_limit_buckets
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_direct_chat_message_rate_limit(
  p_key text,
  p_max_requests integer,
  p_window_ms integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $consume_direct_chat_message_rate_limit$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reset_at timestamptz;
  v_count integer;
  v_window_seconds integer;
BEGIN
  -- Exact contracts prevent this private helper from becoming a generic
  -- low-entropy hashing oracle if it is accidentally referenced later.
  IF p_key IS NULL
     OR p_key !~ '^chat:direct:(minute|day):uuid-sha256:[0-9a-f]{64}$'
     OR NOT (
       (p_key LIKE 'chat:direct:minute:%' AND p_max_requests = 30 AND p_window_ms = 60000)
       OR (p_key LIKE 'chat:direct:day:%' AND p_max_requests = 500 AND p_window_ms = 86400000)
     ) THEN
    RETURN false;
  END IF;

  v_window_seconds := greatest(
    1,
    pg_catalog.ceil(p_window_ms / 1000.0)::integer
  );

  WITH expired AS (
    SELECT bucket.key
    FROM public.rate_limit_buckets AS bucket
    WHERE bucket.reset_at <= v_now
    ORDER BY bucket.reset_at, bucket.key
    LIMIT 128
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.rate_limit_buckets AS bucket
  USING expired
  WHERE bucket.key = expired.key;

  INSERT INTO public.rate_limit_buckets AS bucket (
    key,
    count,
    reset_at,
    updated_at
  ) VALUES (
    p_key,
    0,
    v_now + pg_catalog.make_interval(secs => v_window_seconds),
    v_now
  )
  ON CONFLICT (key) DO NOTHING;

  SELECT bucket.count, bucket.reset_at
  INTO v_count, v_reset_at
  FROM public.rate_limit_buckets AS bucket
  WHERE bucket.key = p_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_reset_at <= v_now THEN
    UPDATE public.rate_limit_buckets AS bucket
    SET count = 1,
        reset_at = v_now + pg_catalog.make_interval(secs => v_window_seconds),
        updated_at = v_now
    WHERE bucket.key = p_key;
    RETURN true;
  END IF;

  IF v_count >= p_max_requests THEN
    RETURN false;
  END IF;

  UPDATE public.rate_limit_buckets AS bucket
  SET count = bucket.count + 1,
      updated_at = v_now
  WHERE bucket.key = p_key;

  RETURN true;
END;
$consume_direct_chat_message_rate_limit$;

CREATE OR REPLACE FUNCTION public.guard_direct_chat_message_insert_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $guard_direct_chat_message_insert_rate$
DECLARE
  v_subject_digest text;
BEGIN
  -- Server-owned writes have their own persistent API limits and may need to
  -- atomically persist AI/care messages. This guard closes only the direct
  -- authenticated database path.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL
     OR NEW.sender_id IS DISTINCT FROM auth.uid()
     OR NEW.role IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'direct_chat_insert_actor_invalid'
      USING ERRCODE = '42501';
  END IF;

  v_subject_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'hanbang:direct-chat:v1' || pg_catalog.chr(31) || NEW.sender_id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  IF public.consume_direct_chat_message_rate_limit(
       'chat:direct:minute:uuid-sha256:' || v_subject_digest,
       30,
       60000
     ) IS NOT TRUE
     OR public.consume_direct_chat_message_rate_limit(
       'chat:direct:day:uuid-sha256:' || v_subject_digest,
       500,
       86400000
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'direct_chat_rate_limit_exceeded'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$guard_direct_chat_message_insert_rate$;

ALTER FUNCTION public.consume_direct_chat_message_rate_limit(text, integer, integer)
  OWNER TO postgres;
ALTER FUNCTION public.guard_direct_chat_message_insert_rate()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_direct_chat_message_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_direct_chat_message_insert_rate()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_direct_chat_message_insert_rate
  ON public.chat_messages;
CREATE TRIGGER trg_guard_direct_chat_message_insert_rate
BEFORE INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_chat_message_insert_rate();

DO $postcondition$
DECLARE
  function_signature text;
  function_record pg_catalog.pg_proc%ROWTYPE;
  trigger_record pg_catalog.pg_trigger%ROWTYPE;
  bucket_table pg_catalog.pg_class%ROWTYPE;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.consume_direct_chat_message_rate_limit(text,integer,integer)',
    'public.guard_direct_chat_message_insert_rate()'
  ]::text[]
  LOOP
    SELECT * INTO function_record
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = pg_catalog.to_regprocedure(function_signature);

    IF NOT FOUND
       OR pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
       OR function_record.prosecdef IS NOT TRUE
       OR function_record.proconfig IS DISTINCT FROM ARRAY[
         'search_path=""',
         'lock_timeout=5s',
         'statement_timeout=10s'
       ]::text[]
       OR pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'DIRECT_CHAT_RATE_LIMIT_FUNCTION_INVALID: %', function_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT * INTO trigger_record
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.chat_messages'::pg_catalog.regclass
    AND trigger.tgname = 'trg_guard_direct_chat_message_insert_rate'
    AND trigger.tgisinternal IS FALSE;

  -- ROW (1) + BEFORE (2) + INSERT (4) = 7.
  IF NOT FOUND
     OR trigger_record.tgtype <> 7
     OR trigger_record.tgfoid <> pg_catalog.to_regprocedure(
       'public.guard_direct_chat_message_insert_rate()'
     ) THEN
    RAISE EXCEPTION 'DIRECT_CHAT_RATE_LIMIT_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO bucket_table
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = 'public.rate_limit_buckets'::pg_catalog.regclass;

  IF bucket_table.relrowsecurity IS NOT TRUE
     OR bucket_table.relforcerowsecurity IS NOT TRUE
     OR pg_catalog.has_table_privilege(
       'anon', 'public.rate_limit_buckets', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.rate_limit_buckets', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'DIRECT_CHAT_RATE_LIMIT_BUCKET_AUTHORITY_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$postcondition$;

COMMENT ON FUNCTION public.consume_direct_chat_message_rate_limit(text, integer, integer) IS
  'Private exact-contract limiter for pseudonymous native chat UUID subjects.';
COMMENT ON FUNCTION public.guard_direct_chat_message_insert_rate() IS
  'Serializes and bounds direct authenticated chat inserts to 30/minute and 500/day per auth user.';

COMMIT;
