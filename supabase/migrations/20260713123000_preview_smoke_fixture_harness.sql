-- Remote smoke fixtures are intentionally unavailable until a database
-- administrator enables one exact non-production project for at most 24 hours.
-- A service-role key alone can neither enable this harness nor target production.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
ALTER SCHEMA private OWNER TO postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.preview_smoke_projects (
  project_ref text PRIMARY KEY
    CHECK (project_ref ~ '^[a-z0-9]{8,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  enabled_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 200),
  CHECK (enabled_until > created_at),
  CHECK (enabled_until <= created_at + interval '24 hours'),
  CONSTRAINT preview_smoke_projects_production_ref_check
    CHECK (project_ref <> ALL (ARRAY[
      'slrtobkksjmxgzatjyqb'
    ]::text[]))
);

CREATE TABLE private.preview_smoke_fixture_couples (
  couple_id uuid PRIMARY KEY
    REFERENCES public.couples(id) ON DELETE CASCADE,
  project_ref text NOT NULL
    REFERENCES private.preview_smoke_projects(project_ref),
  owner_user_id uuid NOT NULL
    REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.preview_smoke_projects OWNER TO postgres;
ALTER TABLE private.preview_smoke_fixture_couples OWNER TO postgres;

REVOKE ALL ON TABLE private.preview_smoke_projects
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.preview_smoke_fixture_couples
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_preview_smoke_authorized(
  p_project_ref text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  v_headers jsonb;
  v_request_host text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'preview smoke authorization failed'
      USING ERRCODE = '42501';
  END IF;

  IF p_project_ref IS NULL
     OR p_project_ref !~ '^[a-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'preview smoke authorization failed'
      USING ERRCODE = '42501';
  END IF;

  IF p_project_ref = ANY (ARRAY[
    'slrtobkksjmxgzatjyqb'
  ]::text[]) THEN
    RAISE EXCEPTION 'preview smoke authorization failed'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_headers := COALESCE(
      NULLIF(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'preview smoke authorization failed'
      USING ERRCODE = '42501';
  END;

  v_request_host := lower(split_part(COALESCE(v_headers ->> 'host', ''), ':', 1));
  IF v_request_host <> p_project_ref || '.supabase.co' THEN
    RAISE EXCEPTION 'preview smoke authorization failed'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM private.preview_smoke_projects AS approved
    WHERE approved.project_ref = p_project_ref
      AND approved.enabled_until > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'preview smoke authorization failed'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;
ALTER FUNCTION private.assert_preview_smoke_authorized(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_preview_smoke_authorized(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_preview_smoke_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  v_email text;
  v_created_at timestamptz;
  v_is_admin boolean;
  v_app_role text;
BEGIN
  SELECT
    lower(account.email),
    account.created_at,
    COALESCE(profile.is_admin, false),
    COALESCE(account.raw_app_meta_data ->> 'role', '')
  INTO v_email, v_created_at, v_is_admin, v_app_role
  FROM auth.users AS account
  LEFT JOIN public.profiles AS profile ON profile.id = account.id
  WHERE account.id = p_user_id;

  IF NOT FOUND
     OR v_email NOT LIKE 'hanbang-smoke-%@example.invalid'
     OR v_email !~ '^hanbang-smoke-[a-z0-9-]+@example[.]invalid$'
     OR v_created_at < clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'preview smoke fixture user is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF v_is_admin OR v_app_role IN ('admin', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'privilege escalation fixture is forbidden'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;
ALTER FUNCTION private.assert_preview_smoke_user(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_preview_smoke_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_preview_smoke_ready(p_project_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN
  PERFORM private.assert_preview_smoke_authorized(p_project_ref);
  RETURN jsonb_build_object('ready', true, 'project_ref', p_project_ref);
END;
$function$;
ALTER FUNCTION public.assert_preview_smoke_ready(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_preview_smoke_ready(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_preview_smoke_ready(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_preview_lifecycle_smoke_fixture(
  p_project_ref text,
  p_operation text,
  p_user_id uuid,
  p_couple_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  v_couple public.couples%ROWTYPE;
  v_new_couple_id uuid;
  v_invite_code text;
BEGIN
  PERFORM private.assert_preview_smoke_authorized(p_project_ref);
  PERFORM private.assert_preview_smoke_user(p_user_id);

  IF NOT (p_operation IN ('assert_blocked_invite', 'set_legacy_invite', 'create_zero_member')) THEN
    RAISE EXCEPTION 'unsupported preview smoke fixture operation'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation = 'create_zero_member' THEN
    IF p_couple_id IS NOT NULL THEN
      RAISE EXCEPTION 'zero-member fixture does not accept a couple id'
        USING ERRCODE = '22023';
    END IF;

    v_invite_code := 'WH-' || upper(substr(
      replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      1,
      12
    ));
    INSERT INTO public.couples (invite_code)
    VALUES (v_invite_code)
    RETURNING id INTO v_new_couple_id;

    INSERT INTO private.preview_smoke_fixture_couples (
      couple_id, project_ref, owner_user_id
    ) VALUES (
      v_new_couple_id, p_project_ref, p_user_id
    );

    RETURN jsonb_build_object(
      'operation', p_operation,
      'couple_id', v_new_couple_id,
      'invite_code', v_invite_code
    );
  END IF;

  SELECT couple.*
  INTO v_couple
  FROM public.couples AS couple
  JOIN public.profiles AS profile
    ON profile.id = p_user_id
   AND profile.couple_id = couple.id
  WHERE couple.id = p_couple_id
    AND (
      (couple.bride_id = p_user_id AND couple.groom_id IS NULL)
      OR (couple.groom_id = p_user_id AND couple.bride_id IS NULL)
    )
  FOR UPDATE OF couple;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview smoke fixture is not an isolated one-member couple'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.preview_smoke_fixture_couples (
    couple_id, project_ref, owner_user_id
  ) VALUES (
    p_couple_id, p_project_ref, p_user_id
  )
  ON CONFLICT (couple_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM private.preview_smoke_fixture_couples AS fixture
    WHERE fixture.couple_id = p_couple_id
      AND fixture.project_ref = p_project_ref
      AND fixture.owner_user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'preview smoke fixture ownership mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation = 'set_legacy_invite' THEN
    IF v_couple.amora_replacement_blocked_at IS NOT NULL THEN
      RAISE EXCEPTION 'blocked couples cannot receive a legacy fixture invite'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.couples
    SET invite_code = 'ABC123',
        updated_at = clock_timestamp()
    WHERE id = p_couple_id;

    RETURN jsonb_build_object(
      'operation', p_operation,
      'couple_id', p_couple_id,
      'invite_code', 'ABC123'
    );
  END IF;

  IF v_couple.amora_replacement_blocked_at IS NULL
     OR v_couple.invite_code IS NOT NULL THEN
    RAISE EXCEPTION 'blocked-invite fixture precondition failed'
      USING ERRCODE = '42501';
  END IF;

  v_invite_code := 'WH-' || upper(substr(
    replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    1,
    12
  ));
  BEGIN
    UPDATE public.couples
    SET invite_code = v_invite_code,
        updated_at = clock_timestamp()
    WHERE id = p_couple_id;

    RETURN jsonb_build_object(
      'operation', p_operation,
      'accepted', true,
      'sqlstate', NULL
    );
  EXCEPTION WHEN check_violation THEN
    RETURN jsonb_build_object(
      'operation', p_operation,
      'accepted', false,
      'sqlstate', '23514'
    );
  END;
END;
$function$;
ALTER FUNCTION public.prepare_preview_lifecycle_smoke_fixture(text, text, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_preview_lifecycle_smoke_fixture(text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_preview_lifecycle_smoke_fixture(text, text, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.inspect_preview_amora_smoke_turn(
  p_project_ref text,
  p_user_id uuid,
  p_couple_id uuid,
  p_client_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  v_model text;
  v_success boolean;
  v_assistant_count bigint;
  v_visibility text;
BEGIN
  PERFORM private.assert_preview_smoke_authorized(p_project_ref);
  PERFORM private.assert_preview_smoke_user(p_user_id);

  IF p_client_request_id !~ '^smoke-(luna|terra)-[0-9]{13}-[a-f0-9]{8}$' THEN
    RAISE EXCEPTION 'invalid preview smoke request id'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    JOIN public.couples AS couple ON couple.id = profile.couple_id
    WHERE profile.id = p_user_id
      AND couple.id = p_couple_id
      AND p_user_id IN (couple.bride_id, couple.groom_id)
  ) THEN
    RAISE EXCEPTION 'preview smoke couple ownership mismatch'
      USING ERRCODE = '42501';
  END IF;

  SELECT audit.model, audit.success
  INTO v_model, v_success
  FROM public.ai_interactions_log AS audit
  WHERE audit.user_id = p_user_id
    AND audit.couple_id = p_couple_id
    AND audit.metadata ->> 'client_request_id' = p_client_request_id
  ORDER BY audit.created_at DESC
  LIMIT 1;

  SELECT
    count(*),
    min(message.visibility)
  INTO v_assistant_count, v_visibility
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND (message.sender_type = 'ai' OR message.role = 'assistant')
    AND message.metadata ->> 'client_request_id' = p_client_request_id;

  RETURN jsonb_build_object(
    'audit_model', v_model,
    'audit_success', v_success,
    'assistant_count', v_assistant_count,
    'visibility', v_visibility
  );
END;
$function$;
ALTER FUNCTION public.inspect_preview_amora_smoke_turn(text, uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.inspect_preview_amora_smoke_turn(text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inspect_preview_amora_smoke_turn(text, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_preview_smoke_fixture(
  p_project_ref text,
  p_user_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid;
  v_distinct_user_count integer;
  v_couple_ids uuid[];
  v_request_keys text[];
  v_couples_deleted integer := 0;
BEGIN
  PERFORM private.assert_preview_smoke_authorized(p_project_ref);

  IF p_user_ids IS NULL
     OR pg_catalog.cardinality(p_user_ids) NOT BETWEEN 1 AND 20
     OR array_position(p_user_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'preview smoke cleanup user list is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT input_user_id)
  INTO v_distinct_user_count
  FROM unnest(p_user_ids) AS input_user_id;
  IF v_distinct_user_count <> pg_catalog.cardinality(p_user_ids) THEN
    RAISE EXCEPTION 'preview smoke cleanup user list contains duplicates'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_user_id IN ARRAY p_user_ids
  LOOP
    PERFORM private.assert_preview_smoke_user(v_user_id);
  END LOOP;

  -- Freeze the private registry while candidates are derived, then lock every
  -- candidate couple and referencing profile before validating or deleting.
  -- A third party that joined a registered zero-member fixture therefore makes
  -- cleanup fail closed instead of having their couple deleted.
  LOCK TABLE private.preview_smoke_fixture_couples
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(
    pg_catalog.array_agg(
      DISTINCT candidate.couple_id ORDER BY candidate.couple_id
    ),
    ARRAY[]::uuid[]
  )
  INTO v_couple_ids
  FROM (
    SELECT couple.id AS couple_id
    FROM public.couples AS couple
    WHERE (couple.bride_id = ANY(p_user_ids) OR couple.groom_id = ANY(p_user_ids))
    UNION
    SELECT profile.couple_id
    FROM public.profiles AS profile
    WHERE profile.id = ANY(p_user_ids)
      AND profile.couple_id IS NOT NULL
    UNION
    SELECT fixture.couple_id
    FROM private.preview_smoke_fixture_couples AS fixture
    WHERE fixture.project_ref = p_project_ref
      AND fixture.owner_user_id = ANY(p_user_ids)
  ) AS candidate;

  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = ANY(v_couple_ids)
  ORDER BY couple.id
  FOR UPDATE;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = ANY(p_user_ids)
     OR profile.couple_id = ANY(v_couple_ids)
  ORDER BY profile.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.couples AS couple
    WHERE couple.id = ANY(v_couple_ids)
      AND (
        (couple.bride_id IS NOT NULL AND NOT (couple.bride_id = ANY(p_user_ids)))
        OR (couple.groom_id IS NOT NULL AND NOT (couple.groom_id = ANY(p_user_ids)))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.couple_id = ANY(v_couple_ids)
      AND NOT (profile.id = ANY(p_user_ids))
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = ANY(p_user_ids)
      AND profile.couple_id IS NOT NULL
      AND (
        NOT (profile.couple_id = ANY(v_couple_ids))
        OR NOT EXISTS (
          SELECT 1
          FROM public.couples AS couple
          WHERE couple.id = profile.couple_id
            AND profile.id IN (couple.bride_id, couple.groom_id)
        )
      )
  ) THEN
    RAISE EXCEPTION 'preview smoke fixture is mixed with a non-fixture account'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT reservation.request_key),
    ARRAY[]::text[]
  )
  INTO v_request_keys
  FROM public.amora_usage_reservations AS reservation
  WHERE reservation.couple_id = ANY(v_couple_ids);

  DELETE FROM public.amora_provider_leases AS lease
  WHERE lease.user_id = ANY(p_user_ids)
     OR lease.couple_id = ANY(v_couple_ids);

  DELETE FROM public.ai_interactions_log AS audit
  WHERE audit.user_id = ANY(p_user_ids)
     OR audit.couple_id = ANY(v_couple_ids);

  DELETE FROM public.chat_summaries AS summary
  WHERE summary.user_id = ANY(p_user_ids)
     OR summary.couple_id = ANY(v_couple_ids);

  DELETE FROM public.chat_feedback AS feedback
  WHERE feedback.user_id = ANY(p_user_ids)
     OR feedback.couple_id = ANY(v_couple_ids);

  DELETE FROM public.account_deletion_jobs AS job
  WHERE job.user_id = ANY(p_user_ids);

  DELETE FROM public.account_deletions AS deletion
  WHERE deletion.user_id = ANY(p_user_ids);

  DELETE FROM public.couples AS couple
  WHERE couple.id = ANY(v_couple_ids)
    AND (couple.bride_id IS NULL OR couple.bride_id = ANY(p_user_ids))
    AND (couple.groom_id IS NULL OR couple.groom_id = ANY(p_user_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.couple_id = couple.id
        AND NOT (profile.id = ANY(p_user_ids))
    );
  GET DIAGNOSTICS v_couples_deleted = ROW_COUNT;
  IF v_couples_deleted <> pg_catalog.cardinality(v_couple_ids) THEN
    RAISE EXCEPTION 'preview smoke cleanup candidate changed before deletion'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.amora_request_claims AS claim
  WHERE claim.request_key = ANY(v_request_keys)
    AND NOT EXISTS (
      SELECT 1
      FROM public.amora_usage_reservations AS reservation
      WHERE reservation.request_key = claim.request_key
    );

  DELETE FROM public.amora_turn_counters AS counter
  WHERE EXISTS (
    SELECT 1
    FROM unnest(v_couple_ids) AS fixture_couple_id
    WHERE counter.key = 'couple:user_turns:' || fixture_couple_id::text
       OR counter.key = 'couple:' || fixture_couple_id::text
       OR counter.key LIKE
         'couple:provider_calls:' || fixture_couple_id::text || ':%'
  );

  DELETE FROM private.preview_smoke_fixture_couples AS fixture
  WHERE fixture.project_ref = p_project_ref
    AND fixture.owner_user_id = ANY(p_user_ids);

  RETURN jsonb_build_object(
    'users_validated', pg_catalog.cardinality(p_user_ids),
    'couples_deleted', v_couples_deleted
  );
END;
$function$;
ALTER FUNCTION public.cleanup_preview_smoke_fixture(text, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cleanup_preview_smoke_fixture(text, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_preview_smoke_fixture(text, uuid[])
  TO service_role;

COMMENT ON TABLE private.preview_smoke_projects IS
  'Database-admin-only, expiring allowlist for destructive non-production smoke fixtures.';
COMMENT ON FUNCTION public.assert_preview_smoke_ready(text) IS
  'Read-only preflight proving the exact project/Host has an active DB-admin smoke allowlist.';
COMMENT ON FUNCTION public.prepare_preview_lifecycle_smoke_fixture(text, text, uuid, uuid) IS
  'Preview-only fixture mutations, restricted to isolated, recent @example.invalid smoke users.';
COMMENT ON FUNCTION public.inspect_preview_amora_smoke_turn(text, uuid, uuid, text) IS
  'Preview-only minimal Amora audit evidence; never returns prompts or response content.';
COMMENT ON FUNCTION public.cleanup_preview_smoke_fixture(text, uuid[]) IS
  'Preview-only cleanup for isolated smoke users and their registered fixture couples.';

DO $assert_preview_smoke_acl$
DECLARE
  expected record;
  browser_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace_row
    WHERE namespace_row.nspname = 'private'
      AND pg_catalog.pg_get_userbyid(namespace_row.nspowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'preview smoke private schema owner mismatch';
  END IF;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF pg_catalog.has_schema_privilege(browser_role, 'private', 'USAGE,CREATE') THEN
      RAISE EXCEPTION 'preview smoke private schema ACL mismatch for %',
        browser_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(namespace_row.nspacl)
      AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    JOIN pg_catalog.pg_roles AS grantor_role
      ON grantor_role.oid = privilege_row.grantor
    WHERE namespace_row.nspname = 'private'
      AND (
        privilege_row.grantee = 0
        OR COALESCE(granted_role.rolname, '') <> 'postgres'
        OR privilege_row.is_grantable
        OR grantor_role.rolname <> 'postgres'
      )
  ) THEN
    RAISE EXCEPTION 'preview smoke private schema direct ACL mismatch';
  END IF;

  FOR expected IN
    SELECT *
    FROM (VALUES
      ('preview_smoke_projects'),
      ('preview_smoke_fixture_couples')
    ) AS required(table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_row
      JOIN pg_catalog.pg_namespace AS namespace_row
        ON namespace_row.oid = relation_row.relnamespace
      WHERE namespace_row.nspname = 'private'
        AND relation_row.relname = expected.table_name
        AND relation_row.relkind = 'r'
        AND pg_catalog.pg_get_userbyid(relation_row.relowner) = 'postgres'
    ) THEN
      RAISE EXCEPTION 'preview smoke private table owner mismatch on %',
        expected.table_name;
    END IF;

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
      IF pg_catalog.has_table_privilege(
           browser_role,
           pg_catalog.format('private.%I', expected.table_name),
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
         )
         OR pg_catalog.has_any_column_privilege(
           browser_role,
           pg_catalog.format('private.%I', expected.table_name),
           'SELECT,INSERT,UPDATE,REFERENCES'
         ) THEN
        RAISE EXCEPTION 'preview smoke private table ACL mismatch on %.%',
          expected.table_name,
          browser_role;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation_row.relacl)
        AS privilege_row
      LEFT JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = privilege_row.grantee
      JOIN pg_catalog.pg_roles AS grantor_role
        ON grantor_role.oid = privilege_row.grantor
      WHERE relation_row.oid = pg_catalog.to_regclass(
          pg_catalog.format('private.%I', expected.table_name)
        )
        AND (
          privilege_row.grantee = 0
          OR COALESCE(granted_role.rolname, '') <> 'postgres'
          OR privilege_row.is_grantable
          OR grantor_role.rolname <> 'postgres'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        AS privilege_row
      WHERE attribute_row.attrelid = pg_catalog.to_regclass(
          pg_catalog.format('private.%I', expected.table_name)
        )
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
    ) THEN
      RAISE EXCEPTION 'preview smoke private direct ACL mismatch on %',
        expected.table_name;
    END IF;
  END LOOP;

  FOR expected IN
    SELECT *
    FROM (VALUES
      ('private.assert_preview_smoke_authorized(text)', false),
      ('private.assert_preview_smoke_user(uuid)', false),
      ('public.assert_preview_smoke_ready(text)', true),
      (
        'public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
        true
      ),
      ('public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)', true),
      ('public.cleanup_preview_smoke_fixture(text,uuid[])', true)
    ) AS required(function_signature, service_execute)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = expected.function_signature::pg_catalog.regprocedure
        AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
        AND procedure_row.prosecdef
        AND procedure_row.proconfig =
          ARRAY['search_path=""', 'row_security=off']::text[]
    )
    OR pg_catalog.has_function_privilege(
      'service_role', expected.function_signature, 'EXECUTE'
    ) IS DISTINCT FROM expected.service_execute
    OR pg_catalog.has_function_privilege(
      'anon', expected.function_signature, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated', expected.function_signature, 'EXECUTE'
    )
    OR NOT COALESCE((
      SELECT
        count(*) = CASE WHEN expected.service_execute THEN 1 ELSE 0 END
        AND COALESCE(bool_and(
          privilege_row.privilege_type = 'EXECUTE'
          AND NOT privilege_row.is_grantable
          AND grantor_role.rolname = 'postgres'
        ), true)
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(procedure_row.proacl)
        AS privilege_row
      JOIN pg_catalog.pg_roles AS grantor_role
        ON grantor_role.oid = privilege_row.grantor
      WHERE procedure_row.oid = expected.function_signature::pg_catalog.regprocedure
        AND privilege_row.grantee = (
          SELECT role_row.oid
          FROM pg_catalog.pg_roles AS role_row
          WHERE role_row.rolname = 'service_role'
        )
    ), false)
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(procedure_row.proacl)
        AS privilege_row
      LEFT JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = privilege_row.grantee
      JOIN pg_catalog.pg_roles AS grantor_role
        ON grantor_role.oid = privilege_row.grantor
      WHERE procedure_row.oid = expected.function_signature::pg_catalog.regprocedure
        AND (
          privilege_row.grantee = 0
          OR COALESCE(granted_role.rolname, '') NOT IN ('postgres', 'service_role')
          OR privilege_row.is_grantable
          OR grantor_role.rolname <> 'postgres'
        )
    ) THEN
      RAISE EXCEPTION 'preview smoke function contract mismatch on %',
        expected.function_signature;
    END IF;
  END LOOP;
END;
$assert_preview_smoke_acl$;

COMMIT;
