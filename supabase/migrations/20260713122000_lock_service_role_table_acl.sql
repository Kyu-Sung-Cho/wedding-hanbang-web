-- Replace historical service_role table-wide ALL grants with the smallest
-- direct DML surface used by the current server. Tables operated exclusively
-- through reviewed SECURITY DEFINER RPCs expose no direct table privilege.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $rebuild_service_role_table_acl$
DECLARE
  relation_name text;
  all_columns text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'amora_turn_counters',
    'amora_usage_reservations',
    'rate_limit_buckets',
    'couples',
    'account_deletions',
    'customer_survey_responses',
    'chat_feedback',
    'chat_summaries',
    'amora_actions',
    'wedding_code_responses',
    'community_upload_reservations',
    'account_deletion_jobs',
    'amora_request_claims',
    'amora_provider_leases'
  ]
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

    IF all_columns IS NULL THEN
      RAISE EXCEPTION 'required service table is missing: %', relation_name;
    END IF;

    EXECUTE pg_catalog.format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, service_role',
      all_columns,
      relation_name
    );
    EXECUTE pg_catalog.format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, service_role',
      all_columns,
      relation_name
    );
    EXECUTE pg_catalog.format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, service_role',
      all_columns,
      relation_name
    );
    EXECUTE pg_catalog.format(
        'REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, service_role',
      all_columns,
      relation_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, service_role',
      relation_name
    );
  END LOOP;
END;
$rebuild_service_role_table_acl$;

GRANT SELECT, DELETE ON TABLE public.rate_limit_buckets TO service_role;
GRANT SELECT ON TABLE public.couples TO service_role;
GRANT UPDATE ON TABLE public.account_deletions TO service_role;
GRANT SELECT, DELETE ON TABLE public.chat_feedback TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.chat_summaries TO service_role;
GRANT SELECT, UPDATE ON TABLE public.account_deletion_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.amora_request_claims
  TO service_role;

DO $assert_service_role_table_acl$
DECLARE
  expected record;
  privilege_name text;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('amora_turn_counters', ARRAY[]::text[]),
      ('amora_usage_reservations', ARRAY[]::text[]),
      ('rate_limit_buckets', ARRAY['SELECT', 'DELETE']::text[]),
      ('couples', ARRAY['SELECT']::text[]),
      ('account_deletions', ARRAY['UPDATE']::text[]),
      ('customer_survey_responses', ARRAY[]::text[]),
      ('chat_feedback', ARRAY['SELECT', 'DELETE']::text[]),
      ('chat_summaries', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
      ('amora_actions', ARRAY[]::text[]),
      ('wedding_code_responses', ARRAY[]::text[]),
      ('community_upload_reservations', ARRAY[]::text[]),
      ('account_deletion_jobs', ARRAY['SELECT', 'UPDATE']::text[]),
      (
        'amora_request_claims',
        ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
      ),
      ('amora_provider_leases', ARRAY[]::text[])
    ) AS required(table_name, privileges)
  LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE',
      'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]
    LOOP
      IF pg_catalog.has_table_privilege(
           'service_role',
           pg_catalog.format('public.%I', expected.table_name),
           privilege_name
         ) IS DISTINCT FROM (privilege_name = ANY(expected.privileges)) THEN
        RAISE EXCEPTION 'service_role table ACL mismatch on %.%',
          expected.table_name,
          privilege_name;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation_row.relacl)
        AS privilege_row
      WHERE relation_row.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND privilege_row.grantee = 0
    ) THEN
      RAISE EXCEPTION 'PUBLIC table ACL remains on %', expected.table_name;
    END IF;

    IF NOT coalesce((
      SELECT
        count(*) = pg_catalog.cardinality(expected.privileges)
        AND coalesce(bool_and(
          privilege_row.privilege_type = ANY(expected.privileges)
          AND NOT privilege_row.is_grantable
          AND grantor.rolname = 'postgres'
        ), true)
      FROM pg_catalog.pg_class AS relation_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation_row.relacl)
        AS privilege_row
      JOIN pg_catalog.pg_roles AS grantor
        ON grantor.oid = privilege_row.grantor
      WHERE relation_row.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND privilege_row.grantee = (
          SELECT role_row.oid
          FROM pg_catalog.pg_roles AS role_row
          WHERE role_row.rolname = 'service_role'
        )
    ), false) THEN
      RAISE EXCEPTION 'service_role direct ACL is not exact on %',
        expected.table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        AS privilege_row
      WHERE attribute_row.attrelid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
        AND (
          privilege_row.grantee = 0
          OR privilege_row.grantee = (
            SELECT role_row.oid
            FROM pg_catalog.pg_roles AS role_row
            WHERE role_row.rolname = 'service_role'
          )
        )
    ) THEN
      RAISE EXCEPTION 'explicit service_role column ACL remains on %',
        expected.table_name;
    END IF;
  END LOOP;
END;
$assert_service_role_table_acl$;
