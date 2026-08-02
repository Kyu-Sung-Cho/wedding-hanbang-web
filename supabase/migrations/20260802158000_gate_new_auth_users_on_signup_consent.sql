-- Close the Supabase Auth API bypass around the application signup route.
--
-- A caller can invoke /auth/v1/signup directly, so application-only consent
-- checks are not an authorization boundary. The application now issues a
-- short-lived random intent through a service-role-only RPC. Supabase Auth's
-- Before User Created Postgres hook atomically consumes that exact intent.
-- New OAuth, magic-link, invite, direct email, replayed, and expired creation
-- attempts fail closed. Existing-user login does not invoke this creation hook.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $signup_consent_preflight$
DECLARE
  missing_role text;
  invalid_column text;
  table_owner text;
BEGIN
  SELECT required.role_name
  INTO missing_role
  FROM unnest(ARRAY[
    'anon',
    'authenticated',
    'service_role',
    'supabase_auth_admin'
  ]::text[]) AS required(role_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS actual
    WHERE actual.rolname = required.role_name
  )
  ORDER BY required.role_name
  LIMIT 1;

  IF missing_role IS NOT NULL THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_REQUIRED_ROLE_MISSING: %', missing_role
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_AUTH_ROLE_FUNCTION_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_SHA256_FUNCTION_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regclass('public.signup_consent_intents') IS NOT NULL THEN
    SELECT pg_catalog.pg_get_userbyid(relation.relowner)
    INTO table_owner
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.signup_consent_intents'::pg_catalog.regclass
      AND relation.relkind = 'r';

    IF table_owner IS DISTINCT FROM current_user THEN
      RAISE EXCEPTION 'SIGNUP_CONSENT_INTENT_TABLE_OWNER_DRIFT'
        USING ERRCODE = '55000';
    END IF;

    IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid =
        'public.signup_consent_intents'::pg_catalog.regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) <> 7 THEN
      RAISE EXCEPTION 'SIGNUP_CONSENT_INTENT_TABLE_SHAPE_DRIFT'
        USING ERRCODE = '55000';
    END IF;

    SELECT attribute.attname
    INTO invalid_column
    FROM pg_catalog.pg_attribute AS attribute
    JOIN (
      VALUES
        ('token_digest', 'bytea', true),
        ('email_token_digest', 'bytea', true),
        ('terms_version', 'text', true),
        ('privacy_version', 'text', true),
        ('marketing_agreed', 'boolean', true),
        ('issued_at', 'timestamp with time zone', true),
        ('expires_at', 'timestamp with time zone', true)
    ) AS expected(column_name, type_name, required_not_null)
      ON expected.column_name = attribute.attname
    WHERE attribute.attrelid =
      'public.signup_consent_intents'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND (
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          IS DISTINCT FROM expected.type_name
        OR attribute.attnotnull IS DISTINCT FROM expected.required_not_null
      )
    ORDER BY attribute.attnum
    LIMIT 1;

    IF invalid_column IS NOT NULL OR EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('token_digest'),
          ('email_token_digest'),
          ('terms_version'),
          ('privacy_version'),
          ('marketing_agreed'),
          ('issued_at'),
          ('expires_at')
      ) AS expected(column_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid =
          'public.signup_consent_intents'::pg_catalog.regclass
          AND attribute.attname = expected.column_name
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      )
    ) THEN
      RAISE EXCEPTION 'SIGNUP_CONSENT_INTENT_COLUMN_DRIFT: %',
        COALESCE(invalid_column, 'missing-column')
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid =
        'public.signup_consent_intents'::pg_catalog.regclass
    ) THEN
      RAISE EXCEPTION 'SIGNUP_CONSENT_INTENT_POLICY_DRIFT'
        USING ERRCODE = '55000';
    END IF;
  END IF;
END;
$signup_consent_preflight$;

CREATE TABLE IF NOT EXISTS public.signup_consent_intents (
  token_digest bytea PRIMARY KEY,
  email_token_digest bytea NOT NULL,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  marketing_agreed boolean NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT signup_consent_intents_token_digest_length
    CHECK (pg_catalog.octet_length(token_digest) = 32),
  CONSTRAINT signup_consent_intents_email_token_digest_length
    CHECK (pg_catalog.octet_length(email_token_digest) = 32),
  CONSTRAINT signup_consent_intents_policy_versions_exact
    CHECK (
      terms_version = '2026-08-02'
      AND privacy_version = '2026-08-02'
    ),
  CONSTRAINT signup_consent_intents_expiry_after_issue
    CHECK (expires_at > issued_at)
);

ALTER TABLE public.signup_consent_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_consent_intents FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS signup_consent_intents_expires_at_idx
  ON public.signup_consent_intents (expires_at);

REVOKE ALL PRIVILEGES ON TABLE public.signup_consent_intents
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.issue_signup_consent_intent(
  p_email text,
  p_token text,
  p_terms_version text,
  p_privacy_version text,
  p_marketing_agreed boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $issue_signup_consent_intent$
DECLARE
  v_email text;
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'signup_consent_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  IF v_email IS NULL
     OR pg_catalog.octet_length(v_email) < 3
     OR pg_catalog.octet_length(v_email) > 254
     OR pg_catalog.strpos(v_email, '@') <= 1
     OR v_email ~ '[[:space:]]' THEN
    RAISE EXCEPTION 'signup_consent_email_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_token IS NULL
     OR pg_catalog.octet_length(p_token) <> 43
     OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'signup_consent_token_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_terms_version IS DISTINCT FROM '2026-08-02'
     OR p_privacy_version IS DISTINCT FROM '2026-08-02' THEN
    RAISE EXCEPTION 'signup_consent_policy_version_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_marketing_agreed IS NULL THEN
    RAISE EXCEPTION 'signup_consent_marketing_value_invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.signup_consent_intents AS intent
  WHERE intent.token_digest IN (
    SELECT expired.token_digest
    FROM public.signup_consent_intents AS expired
    WHERE expired.expires_at <= v_now
    ORDER BY expired.expires_at, expired.token_digest
    LIMIT 100
  );

  -- Pending rows contain no plaintext email or token. Binding the normalized
  -- email to the random token also prevents an offline email dictionary from
  -- recovering addresses from the table alone.
  INSERT INTO public.signup_consent_intents (
    token_digest,
    email_token_digest,
    terms_version,
    privacy_version,
    marketing_agreed,
    issued_at,
    expires_at
  ) VALUES (
    extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'),
    extensions.digest(
      pg_catalog.convert_to(
        v_email || pg_catalog.chr(31) || p_token,
        'UTF8'
      ),
      'sha256'
    ),
    p_terms_version,
    p_privacy_version,
    p_marketing_agreed,
    v_now,
    v_now + pg_catalog.make_interval(mins => 10)
  )
  ON CONFLICT (token_digest) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted = 1;
END;
$issue_signup_consent_intent$;

ALTER FUNCTION public.issue_signup_consent_intent(text, text, text, text, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.issue_signup_consent_intent(text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  public.issue_signup_consent_intent(text, text, text, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_signup_consent_intent(p_token text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $revoke_signup_consent_intent$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'signup_consent_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_token IS NULL
     OR pg_catalog.octet_length(p_token) <> 43
     OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'signup_consent_token_invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.signup_consent_intents AS intent
  WHERE intent.token_digest = extensions.digest(
    pg_catalog.convert_to(p_token, 'UTF8'),
    'sha256'
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$revoke_signup_consent_intent$;

ALTER FUNCTION public.revoke_signup_consent_intent(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_signup_consent_intent(text)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.revoke_signup_consent_intent(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.before_user_created_consent_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $before_user_created_consent_hook$
DECLARE
  v_rejection constant jsonb := pg_catalog.jsonb_build_object(
    'error',
    pg_catalog.jsonb_build_object(
      'http_code', 403,
      'message', 'Signup is not permitted.'
    )
  );
  v_email text;
  v_token text;
  v_user_id_text text;
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_consumed integer := 0;
BEGIN
  IF pg_catalog.jsonb_typeof(event) IS DISTINCT FROM 'object'
     OR event #>> '{metadata,name}' IS DISTINCT FROM 'before-user-created'
     OR pg_catalog.jsonb_typeof(event #> '{user}') IS DISTINCT FROM 'object'
     OR event #> '{user,is_anonymous}' IS DISTINCT FROM 'false'::jsonb
     OR event #>> '{user,app_metadata,provider}' IS DISTINCT FROM 'email'
     OR pg_catalog.jsonb_typeof(event #> '{user,app_metadata,providers}')
       IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(
       event #> '{user,app_metadata,providers}'
     ) <> 1
     OR event #> '{user,app_metadata,providers}'
       IS DISTINCT FROM '["email"]'::jsonb
     OR pg_catalog.jsonb_typeof(event #> '{user,user_metadata}')
       IS DISTINCT FROM 'object' THEN
    RETURN v_rejection;
  END IF;

  v_email := pg_catalog.lower(pg_catalog.btrim(event #>> '{user,email}'));
  v_token := event #>> '{user,user_metadata,signup_consent_intent}';
  v_user_id_text := event #>> '{user,id}';

  IF v_email IS NULL
     OR pg_catalog.octet_length(v_email) < 3
     OR pg_catalog.octet_length(v_email) > 254
     OR pg_catalog.strpos(v_email, '@') <= 1
     OR v_email ~ '[[:space:]]'
     OR v_token IS NULL
     OR pg_catalog.octet_length(v_token) <> 43
     OR v_token !~ '^[A-Za-z0-9_-]{43}$'
     OR v_user_id_text IS NULL
     OR v_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_rejection;
  END IF;

  -- Consumption is deletion, not a retained identity ledger. Trusted policy
  -- evidence is written to auth app_metadata immediately after creation.
  DELETE FROM public.signup_consent_intents AS expired
  WHERE expired.token_digest IN (
    SELECT candidate.token_digest
    FROM public.signup_consent_intents AS candidate
    WHERE candidate.expires_at <= v_now
    ORDER BY candidate.expires_at, candidate.token_digest
    LIMIT 100
  );

  DELETE FROM public.signup_consent_intents AS intent
  WHERE intent.token_digest = extensions.digest(
      pg_catalog.convert_to(v_token, 'UTF8'),
      'sha256'
    )
    AND intent.email_token_digest = extensions.digest(
      pg_catalog.convert_to(
        v_email || pg_catalog.chr(31) || v_token,
        'UTF8'
      ),
      'sha256'
    )
    AND intent.terms_version = '2026-08-02'
    AND intent.privacy_version = '2026-08-02'
    AND intent.expires_at > v_now;

  GET DIAGNOSTICS v_consumed = ROW_COUNT;

  IF v_consumed <> 1 THEN
    RETURN v_rejection;
  END IF;

  RETURN '{}'::jsonb;
END;
$before_user_created_consent_hook$;

ALTER FUNCTION public.before_user_created_consent_hook(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.before_user_created_consent_hook(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.before_user_created_consent_hook(jsonb)
  TO supabase_auth_admin;

DO $signup_consent_postflight$
DECLARE
  missing_constraint text;
BEGIN
  SELECT required.constraint_name
  INTO missing_constraint
  FROM unnest(ARRAY[
    'signup_consent_intents_pkey',
    'signup_consent_intents_token_digest_length',
    'signup_consent_intents_email_token_digest_length',
    'signup_consent_intents_policy_versions_exact',
    'signup_consent_intents_expiry_after_issue'
  ]::text[]) AS required(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS actual
    WHERE actual.conrelid =
      'public.signup_consent_intents'::pg_catalog.regclass
      AND actual.conname = required.constraint_name
      AND actual.convalidated
  )
  ORDER BY required.constraint_name
  LIMIT 1;

  IF missing_constraint IS NOT NULL THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_REQUIRED_CONSTRAINT_MISSING: %',
      missing_constraint
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid =
      'public.signup_consent_intents'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_RLS_NOT_FORCED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_record.indexrelid
    JOIN pg_catalog.pg_attribute AS indexed_column
      ON indexed_column.attrelid = index_record.indrelid
      AND indexed_column.attnum = index_record.indkey[0]
    WHERE index_record.indrelid =
      'public.signup_consent_intents'::pg_catalog.regclass
      AND index_relation.relname = 'signup_consent_intents_expires_at_idx'
      AND indexed_column.attname = 'expires_at'
      AND index_record.indisvalid
      AND index_record.indisready
      AND NOT index_record.indisunique
      AND index_record.indnkeyatts = 1
      AND index_record.indexprs IS NULL
      AND index_record.indpred IS NULL
  ) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_EXPIRY_INDEX_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_table_privilege(
      'anon',
      'public.signup_consent_intents',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR pg_catalog.has_table_privilege(
      'authenticated',
      'public.signup_consent_intents',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR pg_catalog.has_table_privilege(
      'service_role',
      'public.signup_consent_intents',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR pg_catalog.has_table_privilege(
      'supabase_auth_admin',
      'public.signup_consent_intents',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_TABLE_PRIVILEGE_EXPOSED'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_function_privilege(
      'anon',
      'public.issue_signup_consent_intent(text,text,text,text,boolean)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.issue_signup_consent_intent(text,text,text,text,boolean)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'supabase_auth_admin',
      'public.issue_signup_consent_intent(text,text,text,text,boolean)',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.issue_signup_consent_intent(text,text,text,text,boolean)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_ISSUER_ACL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_function_privilege(
      'anon',
      'public.before_user_created_consent_hook(jsonb)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.before_user_created_consent_hook(jsonb)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role',
      'public.before_user_created_consent_hook(jsonb)',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'supabase_auth_admin',
      'public.before_user_created_consent_hook(jsonb)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_HOOK_ACL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_function_privilege(
      'anon',
      'public.revoke_signup_consent_intent(text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.revoke_signup_consent_intent(text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'supabase_auth_admin',
      'public.revoke_signup_consent_intent(text)',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.revoke_signup_consent_intent(text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_REVOKER_ACL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid IN (
      'public.issue_signup_consent_intent(text,text,text,text,boolean)'::pg_catalog.regprocedure,
      'public.revoke_signup_consent_intent(text)'::pg_catalog.regprocedure,
      'public.before_user_created_consent_hook(jsonb)'::pg_catalog.regprocedure
    )
      AND (
        NOT procedure.prosecdef
        OR NOT COALESCE(procedure.proconfig, ARRAY[]::text[])
          @> ARRAY['search_path=""']::text[]
      )
  ) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_FUNCTION_SECURITY_CONFIG_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$signup_consent_postflight$;

COMMIT;
