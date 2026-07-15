-- Raw customer-event and search-query tracking is outside the trusted beta scope.
-- Preserve only a short legacy cleanup window, remove every browser/vendor access
-- path, and block new rows at the database boundary.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $policy_cleanup$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('customer_events', 'search_logs')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$policy_cleanup$;

ALTER TABLE public.customer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs FORCE ROW LEVEL SECURITY;

-- Table-level REVOKE does not remove older column grants. Rebuild both layers
-- before granting only the reviewed retention surface. Historical customer
-- events may be inspected and expired; raw search queries may only be expired.
-- INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are absent.
DO $rebuild_raw_tracking_acl$
DECLARE
  relation_name text;
  all_columns text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['customer_events', 'search_logs']
  LOOP
    SELECT pg_catalog.string_agg(
      pg_catalog.quote_ident(attribute_row.attname),
      ', ' ORDER BY attribute_row.attnum
    )
    INTO all_columns
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = pg_catalog.to_regclass(
        pg_catalog.format('public.%I', relation_name)
      )
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    IF all_columns IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
      EXECUTE pg_catalog.format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
      EXECUTE pg_catalog.format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
      EXECUTE pg_catalog.format(
        'REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      relation_name
    );
  END LOOP;
END;
$rebuild_raw_tracking_acl$;

GRANT SELECT, DELETE ON TABLE public.customer_events TO service_role;
GRANT DELETE ON TABLE public.search_logs TO service_role;

DO $assert_raw_tracking_acl$
DECLARE
  relation_name text;
  expected_privileges text[];
  actual_privileges text[];
  privilege_name text;
  browser_role text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['customer_events', 'search_logs']
  LOOP
    expected_privileges := CASE relation_name
      WHEN 'customer_events' THEN ARRAY['DELETE', 'SELECT']::text[]
      WHEN 'search_logs' THEN ARRAY['DELETE']::text[]
    END;

    SELECT pg_catalog.array_agg(
      privilege_row.privilege_type ORDER BY privilege_row.privilege_type
    )
    INTO actual_privileges
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
      AS privilege_row
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE relation.oid = pg_catalog.to_regclass(
        pg_catalog.format('public.%I', relation_name)
      )
      AND granted_role.rolname = 'service_role';

    IF actual_privileges IS DISTINCT FROM expected_privileges THEN
      RAISE EXCEPTION 'service_role raw-tracking ACL mismatch on %: expected %, got %',
        relation_name,
        expected_privileges,
        actual_privileges;
    END IF;

    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE',
      'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]
    LOOP
      IF pg_catalog.has_table_privilege(
           'service_role',
           pg_catalog.format('public.%I', relation_name),
           privilege_name
         ) IS DISTINCT FROM (privilege_name = ANY(expected_privileges)) THEN
        RAISE EXCEPTION 'effective service_role raw-tracking ACL mismatch on %.%',
          relation_name,
          privilege_name;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS privilege_row
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = privilege_row.grantee
      JOIN pg_catalog.pg_roles AS grantor_role
        ON grantor_role.oid = privilege_row.grantor
      WHERE relation.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', relation_name)
        )
        AND granted_role.rolname = 'service_role'
        AND (
          privilege_row.is_grantable
          OR grantor_role.rolname <> 'postgres'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS privilege_row
      WHERE relation.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', relation_name)
        )
        AND privilege_row.grantee = 0
    ) THEN
      RAISE EXCEPTION 'raw-tracking table ACL provenance mismatch on %',
        relation_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        AS privilege_row
      LEFT JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = privilege_row.grantee
      WHERE attribute_row.attrelid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', relation_name)
        )
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
        AND (
          granted_role.rolname IN ('anon', 'authenticated', 'service_role')
          OR privilege_row.grantee = 0
        )
    ) THEN
      RAISE EXCEPTION 'raw-tracking column ACL remains on %', relation_name;
    END IF;

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF pg_catalog.has_table_privilege(
           browser_role,
           pg_catalog.format('public.%I', relation_name),
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
         )
         OR pg_catalog.has_any_column_privilege(
           browser_role,
           pg_catalog.format('public.%I', relation_name),
           'SELECT,INSERT,UPDATE,REFERENCES'
         ) THEN
        RAISE EXCEPTION '% still has raw-tracking access on %',
          browser_role,
          relation_name;
      END IF;
    END LOOP;
  END LOOP;
END;
$assert_raw_tracking_acl$;

CREATE OR REPLACE FUNCTION public.block_retired_raw_customer_tracking_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'raw_customer_tracking_retired'
    USING ERRCODE = '55000';
END;
$function$;

ALTER FUNCTION public.block_retired_raw_customer_tracking_writes()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_retired_raw_customer_tracking_writes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_retired_raw_customer_tracking_writes()
  TO service_role;

DROP TRIGGER IF EXISTS block_retired_customer_events_writes
  ON public.customer_events;
CREATE TRIGGER block_retired_customer_events_writes
  BEFORE INSERT OR UPDATE ON public.customer_events
  FOR EACH ROW
  EXECUTE FUNCTION public.block_retired_raw_customer_tracking_writes();

DROP TRIGGER IF EXISTS block_retired_search_logs_writes
  ON public.search_logs;
CREATE TRIGGER block_retired_search_logs_writes
  BEFORE INSERT OR UPDATE ON public.search_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.block_retired_raw_customer_tracking_writes();

DELETE FROM public.customer_events
WHERE created_at < now() - interval '90 days';

DELETE FROM public.search_logs
WHERE created_at < now() - interval '90 days';

CREATE OR REPLACE FUNCTION public.enforce_raw_customer_tracking_retention()
RETURNS TABLE(customer_events_deleted integer, search_logs_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_customer_events integer;
  deleted_search_logs integer;
BEGIN
  DELETE FROM public.customer_events
  WHERE created_at < statement_timestamp() - interval '90 days';
  GET DIAGNOSTICS deleted_customer_events = ROW_COUNT;

  DELETE FROM public.search_logs
  WHERE created_at < statement_timestamp() - interval '90 days';
  GET DIAGNOSTICS deleted_search_logs = ROW_COUNT;

  RETURN QUERY SELECT deleted_customer_events, deleted_search_logs;
END;
$function$;

ALTER FUNCTION public.enforce_raw_customer_tracking_retention()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_raw_customer_tracking_retention()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_raw_customer_tracking_retention()
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $schedule_retention$
DECLARE
  job_row record;
BEGIN
  FOR job_row IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'enforce-raw-customer-tracking-retention'
  LOOP
    PERFORM cron.unschedule(job_row.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'enforce-raw-customer-tracking-retention',
    '23 18 * * *',
    'SELECT public.enforce_raw_customer_tracking_retention();'
  );
END;
$schedule_retention$;

COMMENT ON FUNCTION public.enforce_raw_customer_tracking_retention() IS
  'Deletes legacy customer event and search-query rows after 90 days; new raw tracking is retired.';
