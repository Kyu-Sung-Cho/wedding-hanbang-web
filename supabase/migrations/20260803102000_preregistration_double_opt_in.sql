-- Replace direct preregistration writes with a short-lived, email-owned,
-- double-opt-in flow. Pending PII is application-encrypted; Postgres stores
-- only fixed-length lookup digests, an authenticated ciphertext envelope, and
-- server-clock consent evidence. GET requests never consume an intent.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preregistration_preflight$
DECLARE
  missing_role text;
BEGIN
  SELECT expected.role_name
  INTO missing_role
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']::text[])
    AS expected(role_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS actual
    WHERE actual.rolname = expected.role_name
  )
  ORDER BY expected.role_name
  LIMIT 1;

  IF missing_role IS NOT NULL THEN
    RAISE EXCEPTION 'PREREGISTRATION_REQUIRED_ROLE_MISSING: %', missing_role
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'PREREGISTRATION_AUTH_ROLE_FUNCTION_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regclass('public.preregistrations') IS NULL THEN
    RAISE EXCEPTION 'PREREGISTRATION_TARGET_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$preregistration_preflight$;

ALTER TABLE public.preregistrations
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_agreed_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_version text;
ALTER TABLE public.preregistrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preregistrations FORCE ROW LEVEL SECURITY;

-- Service APIs may list verified registrations, but only the security-definer
-- confirmation transaction may create or mutate them.
REVOKE ALL PRIVILEGES ON TABLE public.preregistrations
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.preregistrations FROM service_role;
GRANT SELECT ON TABLE public.preregistrations TO service_role;

DO $preregistration_verified_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.preregistrations'::pg_catalog.regclass
      AND conname = 'preregistrations_verified_consent_evidence'
  ) THEN
    ALTER TABLE public.preregistrations
      ADD CONSTRAINT preregistrations_verified_consent_evidence
      CHECK (
        email_verified_at IS NULL
        OR (
          privacy_agreed_at IS NOT NULL
          AND privacy_version = '2026-08-02'
          AND privacy_agreed_at <= email_verified_at
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.preregistrations'::pg_catalog.regclass
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'PREREGISTRATION_TARGET_RLS_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$preregistration_verified_constraint$;

CREATE INDEX IF NOT EXISTS preregistrations_verified_beta_idx
  ON public.preregistrations (created_at DESC)
  WHERE is_beta_candidate = true AND email_verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.preregistration_intents (
  token_digest bytea PRIMARY KEY,
  email_lookup_digest bytea NOT NULL,
  payload_envelope text NOT NULL,
  privacy_version text NOT NULL,
  consent_agreed_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT preregistration_intents_email_lookup_digest_key
    UNIQUE (email_lookup_digest),
  CONSTRAINT preregistration_intents_token_digest_length
    CHECK (pg_catalog.octet_length(token_digest) = 32),
  CONSTRAINT preregistration_intents_email_lookup_digest_length
    CHECK (pg_catalog.octet_length(email_lookup_digest) = 32),
  CONSTRAINT preregistration_intents_envelope_shape
    CHECK (
      pg_catalog.char_length(payload_envelope) BETWEEN 59 AND 12000
      AND payload_envelope ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
    ),
  CONSTRAINT preregistration_intents_privacy_version_exact
    CHECK (privacy_version = '2026-08-02'),
  CONSTRAINT preregistration_intents_server_clock_consent
    CHECK (consent_agreed_at = issued_at),
  CONSTRAINT preregistration_intents_ttl_exact
    CHECK (expires_at = issued_at + interval '30 minutes')
);

ALTER TABLE public.preregistration_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preregistration_intents FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS preregistration_intents_expires_at_idx
  ON public.preregistration_intents (expires_at, token_digest);

REVOKE ALL PRIVILEGES ON TABLE public.preregistration_intents
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_verified_preregistration()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $guard_verified_preregistration$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.email_verified_at IS NULL
       OR NEW.privacy_agreed_at IS NULL
       OR NEW.privacy_version IS DISTINCT FROM '2026-08-02'
       OR NEW.privacy_agreed_at > NEW.email_verified_at
       OR NEW.email_verified_at > pg_catalog.statement_timestamp() + interval '1 minute' THEN
      RAISE EXCEPTION 'preregistration_email_verification_required'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.email IS DISTINCT FROM OLD.email
       OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at
       OR NEW.privacy_agreed_at IS DISTINCT FROM OLD.privacy_agreed_at
       OR NEW.privacy_version IS DISTINCT FROM OLD.privacy_version THEN
      RAISE EXCEPTION 'preregistration_verification_evidence_immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$guard_verified_preregistration$;

REVOKE ALL ON FUNCTION public.guard_verified_preregistration() FROM PUBLIC;

DROP TRIGGER IF EXISTS preregistrations_verified_write_guard
  ON public.preregistrations;
CREATE TRIGGER preregistrations_verified_write_guard
BEFORE INSERT OR UPDATE ON public.preregistrations
FOR EACH ROW EXECUTE FUNCTION public.guard_verified_preregistration();

CREATE OR REPLACE FUNCTION public.issue_preregistration_intent(
  p_token_digest_hex text,
  p_email_lookup_digest_hex text,
  p_payload_envelope text,
  p_privacy_version text,
  p_consent_confirmed boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $issue_preregistration_intent$
DECLARE
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_affected integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'preregistration_service_role_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_token_digest_hex IS NULL
     OR p_token_digest_hex !~ '^[a-f0-9]{64}$'
     OR p_email_lookup_digest_hex IS NULL
     OR p_email_lookup_digest_hex !~ '^[a-f0-9]{64}$'
     OR p_payload_envelope IS NULL
     OR pg_catalog.char_length(p_payload_envelope) NOT BETWEEN 59 AND 12000
     OR p_payload_envelope !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
     OR p_privacy_version IS DISTINCT FROM '2026-08-02'
     OR p_consent_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'preregistration_intent_contract_invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.preregistration_intents AS expired
  WHERE expired.token_digest IN (
    SELECT candidate.token_digest
    FROM public.preregistration_intents AS candidate
    WHERE candidate.expires_at <= v_now
    ORDER BY candidate.expires_at, candidate.token_digest
    LIMIT 500
  );

  INSERT INTO public.preregistration_intents (
    token_digest,
    email_lookup_digest,
    payload_envelope,
    privacy_version,
    consent_agreed_at,
    issued_at,
    expires_at
  ) VALUES (
    pg_catalog.decode(p_token_digest_hex, 'hex'),
    pg_catalog.decode(p_email_lookup_digest_hex, 'hex'),
    p_payload_envelope,
    p_privacy_version,
    v_now,
    v_now,
    v_now + interval '30 minutes'
  )
  ON CONFLICT (email_lookup_digest) DO UPDATE
  SET token_digest = EXCLUDED.token_digest,
      payload_envelope = EXCLUDED.payload_envelope,
      privacy_version = EXCLUDED.privacy_version,
      consent_agreed_at = EXCLUDED.consent_agreed_at,
      issued_at = EXCLUDED.issued_at,
      expires_at = EXCLUDED.expires_at;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected = 1;
END;
$issue_preregistration_intent$;

CREATE OR REPLACE FUNCTION public.read_preregistration_intent(
  p_token_digest_hex text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $read_preregistration_intent$
DECLARE
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_payload text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'preregistration_service_role_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_token_digest_hex IS NULL OR p_token_digest_hex !~ '^[a-f0-9]{64}$' THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.preregistration_intents AS expired
  WHERE expired.token_digest = pg_catalog.decode(p_token_digest_hex, 'hex')
    AND expired.expires_at <= v_now;

  SELECT intent.payload_envelope
  INTO v_payload
  FROM public.preregistration_intents AS intent
  WHERE intent.token_digest = pg_catalog.decode(p_token_digest_hex, 'hex')
    AND intent.expires_at > v_now
    AND intent.privacy_version = '2026-08-02';

  RETURN v_payload;
END;
$read_preregistration_intent$;

CREATE OR REPLACE FUNCTION public.revoke_preregistration_intent(
  p_token_digest_hex text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $revoke_preregistration_intent$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'preregistration_service_role_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_token_digest_hex IS NULL OR p_token_digest_hex !~ '^[a-f0-9]{64}$' THEN
    RETURN false;
  END IF;

  DELETE FROM public.preregistration_intents AS intent
  WHERE intent.token_digest = pg_catalog.decode(p_token_digest_hex, 'hex');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$revoke_preregistration_intent$;

CREATE OR REPLACE FUNCTION public.confirm_preregistration_intent(
  p_token_digest_hex text,
  p_email_lookup_digest_hex text,
  p_email text,
  p_name text,
  p_wedding_date text,
  p_role text,
  p_message text,
  p_is_beta_candidate boolean,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_privacy_version text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $confirm_preregistration_intent$
DECLARE
  v_intent public.preregistration_intents%ROWTYPE;
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_email text;
  v_inserted_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'preregistration_service_role_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_token_digest_hex IS NULL
     OR p_token_digest_hex !~ '^[a-f0-9]{64}$'
     OR p_email_lookup_digest_hex IS NULL
     OR p_email_lookup_digest_hex !~ '^[a-f0-9]{64}$'
     OR p_privacy_version IS DISTINCT FROM '2026-08-02' THEN
    RETURN 'invalid';
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.preregistration_intents AS intent
  WHERE intent.token_digest = pg_catalog.decode(p_token_digest_hex, 'hex')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;
  IF v_intent.expires_at <= v_now
     OR v_intent.privacy_version IS DISTINCT FROM p_privacy_version
     OR v_intent.email_lookup_digest
       IS DISTINCT FROM pg_catalog.decode(p_email_lookup_digest_hex, 'hex') THEN
    DELETE FROM public.preregistration_intents AS intent
    WHERE intent.token_digest = v_intent.token_digest;
    RETURN 'invalid';
  END IF;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  IF v_email IS NULL
     OR pg_catalog.octet_length(v_email) NOT BETWEEN 3 AND 254
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR (p_name IS NOT NULL AND pg_catalog.char_length(p_name) NOT BETWEEN 1 AND 60)
     OR (
       p_wedding_date IS NOT NULL
       AND (
         p_wedding_date !~ '^\d{4}-\d{2}-\d{2}$'
         OR pg_catalog.to_char(pg_catalog.to_date(p_wedding_date, 'YYYY-MM-DD'), 'YYYY-MM-DD')
           IS DISTINCT FROM p_wedding_date
       )
     )
     OR p_role NOT IN ('bride', 'groom')
     OR (p_message IS NOT NULL AND pg_catalog.char_length(p_message) NOT BETWEEN 1 AND 500)
     OR p_is_beta_candidate IS NULL
     OR (p_utm_source IS NOT NULL AND pg_catalog.char_length(p_utm_source) NOT BETWEEN 1 AND 80)
     OR (p_utm_medium IS NOT NULL AND pg_catalog.char_length(p_utm_medium) NOT BETWEEN 1 AND 80)
     OR (p_utm_campaign IS NOT NULL AND pg_catalog.char_length(p_utm_campaign) NOT BETWEEN 1 AND 120) THEN
    RAISE EXCEPTION 'preregistration_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.preregistrations AS existing
    WHERE pg_catalog.lower(existing.email) = v_email
  ) THEN
    INSERT INTO public.preregistrations (
      email,
      name,
      wedding_date,
      role,
      message,
      is_beta_candidate,
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      privacy_agreed_at,
      privacy_version,
      email_verified_at
    ) VALUES (
      v_email,
      p_name,
      p_wedding_date,
      p_role,
      p_message,
      p_is_beta_candidate,
      CASE WHEN p_is_beta_candidate THEN 'beta' ELSE 'web' END,
      p_utm_source,
      p_utm_medium,
      p_utm_campaign,
      v_intent.consent_agreed_at,
      v_intent.privacy_version,
      v_now
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_inserted_id;
  END IF;

  DELETE FROM public.preregistration_intents AS intent
  WHERE intent.token_digest = v_intent.token_digest;

  RETURN CASE WHEN v_inserted_id IS NULL THEN 'already_registered' ELSE 'confirmed' END;
END;
$confirm_preregistration_intent$;

CREATE OR REPLACE FUNCTION public.purge_expired_preregistration_intents(
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $purge_expired_preregistration_intents$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'preregistration_service_role_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'preregistration_purge_limit_invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.preregistration_intents AS expired
  WHERE expired.token_digest IN (
    SELECT candidate.token_digest
    FROM public.preregistration_intents AS candidate
    WHERE candidate.expires_at <= pg_catalog.statement_timestamp()
    ORDER BY candidate.expires_at, candidate.token_digest
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$purge_expired_preregistration_intents$;

REVOKE ALL ON FUNCTION public.issue_preregistration_intent(text,text,text,text,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_preregistration_intent(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_preregistration_intent(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_expired_preregistration_intents(integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.issue_preregistration_intent(text,text,text,text,boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.read_preregistration_intent(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_preregistration_intent(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_preregistration_intents(integer)
  TO service_role;

DO $preregistration_postflight$
DECLARE
  invalid_column text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.preregistration_intents'::pg_catalog.regclass
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'PREREGISTRATION_INTENT_RLS_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.preregistration_intents'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) <> 7 THEN
    RAISE EXCEPTION 'PREREGISTRATION_INTENT_TABLE_SHAPE_DRIFT'
      USING ERRCODE = '55000';
  END IF;

  SELECT attribute.attname
  INTO invalid_column
  FROM pg_catalog.pg_attribute AS attribute
  JOIN (
    VALUES
      ('token_digest', 'bytea', true),
      ('email_lookup_digest', 'bytea', true),
      ('payload_envelope', 'text', true),
      ('privacy_version', 'text', true),
      ('consent_agreed_at', 'timestamp with time zone', true),
      ('issued_at', 'timestamp with time zone', true),
      ('expires_at', 'timestamp with time zone', true)
  ) AS expected(column_name, type_name, required_not_null)
    ON expected.column_name = attribute.attname
  WHERE attribute.attrelid = 'public.preregistration_intents'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND (
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
        IS DISTINCT FROM expected.type_name
      OR attribute.attnotnull IS DISTINCT FROM expected.required_not_null
    )
  LIMIT 1;

  IF invalid_column IS NOT NULL THEN
    RAISE EXCEPTION 'PREREGISTRATION_INTENT_COLUMN_DRIFT: %', invalid_column
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.preregistration_intents'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'PREREGISTRATION_INTENT_POLICY_EXPOSED'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_table_privilege(
      'anon', 'public.preregistration_intents',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR pg_catalog.has_table_privilege(
      'authenticated', 'public.preregistration_intents',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR pg_catalog.has_table_privilege(
      'service_role', 'public.preregistration_intents',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
    RAISE EXCEPTION 'PREREGISTRATION_INTENT_TABLE_PRIVILEGE_EXPOSED'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_function_privilege(
      'anon',
      'public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'PREREGISTRATION_CONFIRM_ACL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_table_privilege(
      'service_role', 'public.preregistrations',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR NOT pg_catalog.has_table_privilege(
      'service_role', 'public.preregistrations', 'SELECT'
    ) THEN
    RAISE EXCEPTION 'PREREGISTRATION_TARGET_TABLE_ACL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid IN (
      'public.issue_preregistration_intent(text,text,text,text,boolean)'::pg_catalog.regprocedure,
      'public.read_preregistration_intent(text)'::pg_catalog.regprocedure,
      'public.revoke_preregistration_intent(text)'::pg_catalog.regprocedure,
      'public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)'::pg_catalog.regprocedure,
      'public.purge_expired_preregistration_intents(integer)'::pg_catalog.regprocedure,
      'public.guard_verified_preregistration()'::pg_catalog.regprocedure
    )
      AND (
        NOT procedure.prosecdef
        OR NOT COALESCE(procedure.proconfig, ARRAY[]::text[])
          @> ARRAY['search_path=""']::text[]
      )
  ) THEN
    RAISE EXCEPTION 'PREREGISTRATION_FUNCTION_SECURITY_CONFIG_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$preregistration_postflight$;

COMMIT;
