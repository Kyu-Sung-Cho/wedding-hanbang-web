import { createHash, randomBytes } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const PROJECT_REF = /^[a-z0-9]{20}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const RUN_NONCE = /^[a-f0-9]{32}$/u;
const CHAT_POLICY_EXPRESSION_SHA256 =
  "64bbc946e4c70b9629b21e9a151e5faa95c228acb80dfa4f26778f472b246e19";
const DISCLOSURE_POLICY_EXPRESSION_SHA256 =
  "ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f";
const DISCLOSURE_INSERT_POLICY_EXPRESSION_SHA256 =
  "24edd073465ecb17ec3baee29c679abda37160c55eb8bda58ecd20e0c7e625de";
const DISCLOSURE_UPDATE_POLICY_EXPRESSION_SHA256 =
  "2443f1653a213dde8c5e3edec0c42258c90ac94464397cd644ce6c2d1ddc60ac";
const POLICY_CONTRACT_SHA256 =
  "df6c4ca89d9edff53a93042a018708cfc145faeebeb7951524bb8bfb7bb7cac7";
const PRODUCTION_STORAGE_FENCE_SOURCE_SHA256 =
  "806818646e13253b2cd985f40adf1b3f42e8f8855b922ea9dd95e68a875bcd25";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RECOVERY_JOURNAL_BYTES = 64 * 1024;
const MAX_DISCOVERY_BUCKETS = 128;
const MAX_DISCOVERY_POLICIES = 256;
const MAX_DISCOVERY_HELPERS = 64;
const MAX_DISCOVERY_LIST_ITEMS = 128;
const OTHER_USER_ID = "f0000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "e0000000-0000-4000-8000-000000000001";

const UNSIGNED_BUCKETS = Object.freeze([
  "community-media-staging",
  "community-images",
  "community-videos",
]);
const ALL_PROBE_BUCKETS = new Set([...UNSIGNED_BUCKETS, "chat-image"]);
const ACTORS = Object.freeze(["anon", "authenticated"]);

export const STORAGE_STAGING_INVENTORY_SQL = `
WITH expected_buckets(id, is_public, file_size_limit, allowed_mime_types) AS (
  VALUES
    ('chat-image'::text, false, NULL::bigint, NULL::text[]),
    ('cohort-images', true, NULL::bigint, NULL::text[]),
    ('community-images', true, 10 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('community-videos', true, 50 * 1024 * 1024,
      ARRAY['video/mp4','video/quicktime','video/webm']::text[]),
    ('community-media-staging', false, 6 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('guestbook-images', false, NULL::bigint, NULL::text[]),
    ('guestbook-uploads', false, 5 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]),
    ('invitation-photos', true, 10 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[]),
    ('user_photos', true, NULL::bigint, NULL::text[]),
    ('vendor-images', true, 5 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/webp']::text[]),
    ('vendor-licenses', false, 10 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','application/pdf']::text[]),
    ('disclosure-raw', false, 50 * 1024 * 1024,
      ARRAY[
        'application/haansofthwp','application/json','application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/x-hwp','image/png'
      ]::text[]),
    ('disclosure-preview', false, 2 * 1024 * 1024,
      ARRAY['text/plain']::text[])
), relation_contract AS (
  SELECT
    pg_catalog.pg_get_userbyid(c.relowner) AS relation_owner,
    c.relrowsecurity AS relation_rls_enabled,
    c.relforcerowsecurity AS relation_force_rls
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND pg_catalog.pg_get_userbyid(c.relowner) = 'supabase_storage_admin'
), actual_buckets AS (
  SELECT id, name, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
), bucket_contract AS (
  SELECT
    (SELECT count(*)::integer FROM actual_buckets) AS storage_bucket_count,
    (SELECT count(*)::integer FROM actual_buckets
      WHERE id IN ('guestbook-images', 'guestbook-uploads') AND public = false)
      AS retired_guestbook_private_bucket_count,
    NOT EXISTS (
      (SELECT id, id AS name, is_public AS public, file_size_limit, allowed_mime_types
         FROM expected_buckets
       EXCEPT ALL
       SELECT id, name, public, file_size_limit, allowed_mime_types
         FROM actual_buckets)
      UNION ALL
      (SELECT id, name, public, file_size_limit, allowed_mime_types
         FROM actual_buckets
       EXCEPT ALL
       SELECT id, id AS name, is_public AS public, file_size_limit, allowed_mime_types
         FROM expected_buckets)
    ) AS bucket_contract_verified,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE((
      SELECT pg_catalog.string_agg(
        bucket.id || E'\\n' || bucket.name || E'\\n' || bucket.public::text || E'\\n'
          || COALESCE(bucket.file_size_limit::text, '<null>') || E'\\n'
          || COALESCE(bucket.allowed_mime_types::text, '<null>'),
        E'\\n---\\n' ORDER BY bucket.id
      )
      FROM actual_buckets AS bucket
    ), ''), 'UTF8'), 'sha256'), 'hex') AS bucket_contract_sha256
), raw_policies AS (
  SELECT
    policy.policyname,
    policy.permissive::text AS permissive,
    ARRAY(
      SELECT role_name::name
      FROM pg_catalog.unnest(policy.roles) AS role_name
      ORDER BY role_name::text
    ) AS roles,
    policy.cmd::text AS cmd,
    pg_catalog.encode(extensions.digest(
      COALESCE(policy.qual, '') || E'\\n' || COALESCE(policy.with_check, ''),
      'sha256'
    ), 'hex') AS expression_sha256
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
), actual_policies AS (
  SELECT
    CASE
      WHEN permissive = 'PERMISSIVE'
       AND roles = ARRAY['authenticated']::name[]
       AND cmd = 'INSERT'
       AND expression_sha256 = '${CHAT_POLICY_EXPRESSION_SHA256}'
      THEN 'chat-image-strict-insert'
      ELSE policyname
    END AS semantic_key,
    permissive,
    roles,
    cmd,
    expression_sha256
  FROM raw_policies
), expected_policies(
  semantic_key, permissive, roles, cmd, expression_sha256
) AS (
  VALUES
    ('chat-image-strict-insert'::text, 'PERMISSIVE'::text,
      ARRAY['authenticated']::name[], 'INSERT'::text,
      '${CHAT_POLICY_EXPRESSION_SHA256}'::text),
    ('disclosure_evidence_client_select_fence', 'RESTRICTIVE',
      ARRAY['anon','authenticated']::name[], 'SELECT',
      '${DISCLOSURE_POLICY_EXPRESSION_SHA256}'),
    ('disclosure_evidence_client_insert_fence', 'RESTRICTIVE',
      ARRAY['anon','authenticated']::name[], 'INSERT',
      '${DISCLOSURE_INSERT_POLICY_EXPRESSION_SHA256}'),
    ('disclosure_evidence_client_update_fence', 'RESTRICTIVE',
      ARRAY['anon','authenticated']::name[], 'UPDATE',
      '${DISCLOSURE_UPDATE_POLICY_EXPRESSION_SHA256}'),
    ('disclosure_evidence_client_delete_fence', 'RESTRICTIVE',
      ARRAY['anon','authenticated']::name[], 'DELETE',
      '${DISCLOSURE_POLICY_EXPRESSION_SHA256}')
), policy_contract_values AS (
  SELECT
    (SELECT count(*)::integer FROM actual_policies) AS storage_policy_count,
    (SELECT count(*)::integer FROM actual_policies WHERE cmd = 'INSERT')
      AS storage_insert_policy_count,
    NOT EXISTS (
      (SELECT * FROM expected_policies EXCEPT ALL SELECT * FROM actual_policies)
      UNION ALL
      (SELECT * FROM actual_policies EXCEPT ALL SELECT * FROM expected_policies)
    ) AS storage_policy_multiset_verified,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE((
      SELECT pg_catalog.string_agg(
        semantic_key || E'\n' || permissive || E'\n'
          || pg_catalog.array_to_string(roles, ',') || E'\n' || cmd || E'\n'
          || expression_sha256,
        E'\n---\n' ORDER BY semantic_key
      )
      FROM actual_policies
    ), ''), 'UTF8'), 'sha256'), 'hex') AS storage_policy_contract_sha256
), policy_contract AS (
  SELECT
    storage_policy_count,
    storage_insert_policy_count,
    storage_policy_multiset_verified
      AND storage_policy_contract_sha256 = '${POLICY_CONTRACT_SHA256}'
      AS storage_policy_contract_verified,
    storage_policy_contract_sha256
  FROM policy_contract_values
), production_fence_function AS (
  SELECT
    count(*) = 1
      AND pg_catalog.bool_and(
        function_record.prokind = 'f'
        AND language_record.lanname = 'sql'
        AND function_record.prorettype = 'pg_catalog.bool'::pg_catalog.regtype
        AND NOT function_record.proretset
        AND function_record.pronargs = 0
        AND function_record.proargtypes = ''::pg_catalog.oidvector
        AND function_record.prosecdef
        AND function_record.provolatile = 's'
        AND function_record.proparallel = 'u'
        AND NOT function_record.proleakproof
        AND NOT function_record.proisstrict
        AND pg_catalog.pg_get_userbyid(function_record.proowner) = 'postgres'
        AND function_record.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
        AND pg_catalog.has_function_privilege(
          'authenticated', function_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege('anon', function_record.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(
          'service_role', function_record.oid, 'EXECUTE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(COALESCE(
            function_record.proacl,
            pg_catalog.acldefault('f', function_record.proowner)
          )) AS acl_entry
          WHERE acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
        )
        AND NOT EXISTS (
          (
            SELECT
              pg_catalog.pg_get_userbyid(acl_entry.grantor)::text AS grantor,
              CASE WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
                ELSE pg_catalog.pg_get_userbyid(acl_entry.grantee)
              END::text AS grantee,
              acl_entry.privilege_type::text AS privilege_type,
              acl_entry.is_grantable
            FROM pg_catalog.aclexplode(COALESCE(
              function_record.proacl,
              pg_catalog.acldefault('f', function_record.proowner)
            )) AS acl_entry
            EXCEPT ALL
            SELECT * FROM (VALUES
              ('postgres'::text, 'postgres'::text, 'EXECUTE'::text, false),
              ('postgres'::text, 'authenticated'::text, 'EXECUTE'::text, false)
            ) AS expected_acl(grantor, grantee, privilege_type, is_grantable)
          )
          UNION ALL
          (
            SELECT * FROM (VALUES
              ('postgres'::text, 'postgres'::text, 'EXECUTE'::text, false),
              ('postgres'::text, 'authenticated'::text, 'EXECUTE'::text, false)
            ) AS expected_acl(grantor, grantee, privilege_type, is_grantable)
            EXCEPT ALL
            SELECT
              pg_catalog.pg_get_userbyid(acl_entry.grantor)::text,
              CASE WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
                ELSE pg_catalog.pg_get_userbyid(acl_entry.grantee)
              END::text,
              acl_entry.privilege_type::text,
              acl_entry.is_grantable
            FROM pg_catalog.aclexplode(COALESCE(
              function_record.proacl,
              pg_catalog.acldefault('f', function_record.proowner)
            )) AS acl_entry
          )
        )
        AND pg_catalog.encode(extensions.digest(
          function_record.prosrc, 'sha256'
        ), 'hex') = '${PRODUCTION_STORAGE_FENCE_SOURCE_SHA256}'
      ) AS production_storage_fence_function_verified
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_language AS language_record
    ON language_record.oid = function_record.prolang
  WHERE function_record.oid = pg_catalog.to_regprocedure(
    'public.production_storage_writes_allowed()'
  )
), production_fence_state AS (
  SELECT NOT (
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgname = 'trg_production_write_fence_20260717'
        AND NOT trigger_record.tgisinternal
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_event_trigger AS event_trigger_record
      WHERE event_trigger_record.evtname = 'evt_production_write_fence_20260717'
    )
    OR pg_catalog.to_regprocedure(
      'public.production_write_fence_guard_20260717()'
    ) IS NOT NULL
    OR pg_catalog.to_regprocedure(
      'public.production_write_fence_attach_20260717()'
    ) IS NOT NULL
  ) AS production_storage_writes_allowed
), object_rows AS (
  SELECT
    object.bucket_id,
    object.name,
    COALESCE(object.id::text, '') AS object_id,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.to_jsonb(object)::text, 'UTF8'),
      'sha256'
    ), 'hex') AS row_sha256
  FROM storage.objects AS object
), object_inventory AS (
  SELECT
    count(*)::integer AS total_object_count,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE(
      pg_catalog.string_agg(row_sha256, '' ORDER BY bucket_id, name, object_id),
      ''
    ), 'UTF8'), 'sha256'), 'hex') AS object_inventory_sha256
  FROM object_rows
), probe_ids AS (
  SELECT $2::uuid AS user_id, $3::uuid AS couple_id
), nonce_users AS (
  SELECT account.id
  FROM auth.users AS account
  WHERE pg_catalog.strpos(COALESCE(account.email, ''), $1::text) > 0
     OR pg_catalog.strpos(COALESCE(account.raw_user_meta_data::text, ''), $1::text) > 0
), probe_users AS (
  SELECT id FROM nonce_users
  UNION
  SELECT account.id
  FROM auth.users AS account
  CROSS JOIN probe_ids
  WHERE probe_ids.user_id IS NOT NULL
    AND account.id = probe_ids.user_id
), nonce_residue AS (
  SELECT
    (SELECT count(*)::integer FROM probe_users) AS exact_nonce_auth_user_count,
    (SELECT count(*)::integer FROM public.profiles AS profile
      WHERE profile.id = (SELECT user_id FROM probe_ids)
         OR profile.id IN (SELECT id FROM probe_users)) AS exact_nonce_profile_count,
    (SELECT count(*)::integer FROM public.couples AS couple
      WHERE couple.id = (SELECT couple_id FROM probe_ids)
         OR couple.bride_id = (SELECT user_id FROM probe_ids)
         OR couple.groom_id = (SELECT user_id FROM probe_ids)
         OR couple.bride_id IN (SELECT id FROM probe_users)
         OR couple.groom_id IN (SELECT id FROM probe_users)) AS exact_nonce_couple_count,
    (SELECT count(*)::integer FROM storage.objects AS object
      CROSS JOIN probe_ids
      WHERE pg_catalog.strpos(object.name, $1::text) > 0
         OR (object.bucket_id || E'\\n' || object.name) = ANY($4::text[])
         OR (
           probe_ids.user_id IS NOT NULL
           AND probe_ids.couple_id IS NOT NULL
           AND object.bucket_id = 'chat-image'
           AND object.name LIKE (
             probe_ids.couple_id::text || '/' || probe_ids.user_id::text || '/%'
           )
         ))
      AS exact_nonce_storage_object_count
)
SELECT
  pg_catalog.statement_timestamp()::text AS observed_at,
  relation_contract.relation_owner,
  relation_contract.relation_rls_enabled,
  relation_contract.relation_force_rls,
  bucket_contract.storage_bucket_count,
  bucket_contract.retired_guestbook_private_bucket_count,
  bucket_contract.bucket_contract_verified,
  bucket_contract.bucket_contract_sha256,
  policy_contract.storage_policy_count,
  policy_contract.storage_insert_policy_count,
  policy_contract.storage_policy_contract_verified,
  policy_contract.storage_policy_contract_sha256,
  production_fence_function.production_storage_fence_function_verified,
  production_fence_state.production_storage_writes_allowed,
  object_inventory.total_object_count,
  object_inventory.object_inventory_sha256,
  nonce_residue.exact_nonce_auth_user_count,
  nonce_residue.exact_nonce_profile_count,
  nonce_residue.exact_nonce_couple_count,
  nonce_residue.exact_nonce_storage_object_count
FROM relation_contract
CROSS JOIN bucket_contract
CROSS JOIN policy_contract
CROSS JOIN production_fence_function
CROSS JOIN production_fence_state
CROSS JOIN object_inventory
CROSS JOIN nonce_residue
`.trim();

export const STORAGE_STAGING_DISCOVERY_SQL = `
WITH relation_catalog AS (
  SELECT
    pg_catalog.pg_get_userbyid(relation_record.relowner) AS relation_owner,
    relation_record.relrowsecurity AS relation_rls_enabled,
    relation_record.relforcerowsecurity AS relation_force_rls
  FROM pg_catalog.pg_class AS relation_record
  JOIN pg_catalog.pg_namespace AS namespace_record
    ON namespace_record.oid = relation_record.relnamespace
  WHERE namespace_record.nspname = 'storage'
    AND relation_record.relname = 'objects'
  LIMIT 1
), bucket_catalog AS (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', bucket_record.id,
    'name', bucket_record.name,
    'public', bucket_record.public,
    'file_size_limit', bucket_record.file_size_limit,
    'allowed_mime_types', bucket_record.allowed_mime_types
  ) ORDER BY bucket_record.id, bucket_record.name), '[]'::jsonb) AS buckets
  FROM storage.buckets AS bucket_record
), policy_rows AS (
  SELECT
    policy_record.policyname AS name,
    policy_record.permissive::text AS permissive,
    ARRAY(
      SELECT role_record.role_name::text
      FROM pg_catalog.unnest(policy_record.roles) AS role_record(role_name)
      ORDER BY role_record.role_name::text
    ) AS roles,
    policy_record.cmd::text AS command,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      COALESCE(policy_record.qual, ''), 'UTF8'
    ), 'sha256'), 'hex') AS using_expression_sha256,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      COALESCE(policy_record.with_check, ''), 'UTF8'
    ), 'sha256'), 'hex') AS with_check_expression_sha256,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      COALESCE(policy_record.qual, '') || E'\\n'
        || COALESCE(policy_record.with_check, ''),
      'UTF8'
    ), 'sha256'), 'hex') AS expression_sha256
  FROM pg_catalog.pg_policies AS policy_record
  WHERE policy_record.schemaname = 'storage'
    AND policy_record.tablename = 'objects'
), policy_catalog AS (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', policy_row.name,
    'permissive', policy_row.permissive,
    'roles', policy_row.roles,
    'command', policy_row.command,
    'using_expression_sha256', policy_row.using_expression_sha256,
    'with_check_expression_sha256', policy_row.with_check_expression_sha256,
    'expression_sha256', policy_row.expression_sha256
  ) ORDER BY policy_row.name, policy_row.command, policy_row.permissive), '[]'::jsonb)
    AS policies
  FROM policy_rows AS policy_row
), helper_rows AS (
  SELECT
    helper_namespace.nspname AS schema,
    helper_record.proname AS name,
    pg_catalog.pg_get_function_identity_arguments(helper_record.oid)
      AS identity_arguments,
    pg_catalog.pg_get_userbyid(helper_record.proowner) AS owner,
    helper_record.prosecdef AS security_definer,
    CASE helper_record.provolatile
      WHEN 'i' THEN 'IMMUTABLE'
      WHEN 's' THEN 'STABLE'
      ELSE 'VOLATILE'
    END AS volatility,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE(
      pg_catalog.array_to_string(helper_record.proconfig, E'\\n'),
      ''
    ), 'UTF8'), 'sha256'), 'hex') AS config_sha256,
    helper_record.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
      AS search_path_empty,
    ARRAY(
      SELECT execute_role.role_name
      FROM (
        SELECT DISTINCT CASE
          WHEN acl_record.grantee = 0 THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(acl_record.grantee)
        END AS role_name
        FROM pg_catalog.aclexplode(COALESCE(
          helper_record.proacl,
          pg_catalog.acldefault('f', helper_record.proowner)
        )) AS acl_record
        WHERE acl_record.privilege_type = 'EXECUTE'
      ) AS execute_role
      ORDER BY execute_role.role_name
    ) AS execute_roles,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(helper_record.prosrc, 'UTF8'),
      'sha256'
    ), 'hex') AS source_sha256
  FROM pg_catalog.pg_proc AS helper_record
  JOIN pg_catalog.pg_namespace AS helper_namespace
    ON helper_namespace.oid = helper_record.pronamespace
  WHERE helper_namespace.nspname = 'public'
    AND helper_record.proname IN (
      'production_storage_writes_allowed',
      'production_write_fence_guard_20260717',
      'production_write_fence_attach_20260717'
    )
), helper_catalog AS (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema', helper_row.schema,
    'name', helper_row.name,
    'identity_arguments', helper_row.identity_arguments,
    'owner', helper_row.owner,
    'security_definer', helper_row.security_definer,
    'volatility', helper_row.volatility,
    'config_sha256', helper_row.config_sha256,
    'search_path_empty', helper_row.search_path_empty,
    'execute_roles', helper_row.execute_roles,
    'source_sha256', helper_row.source_sha256
  ) ORDER BY helper_row.schema, helper_row.name, helper_row.identity_arguments), '[]'::jsonb)
    AS helper_functions
  FROM helper_rows AS helper_row
), fence_catalog AS (
  SELECT
    ARRAY(
      SELECT DISTINCT trigger_record.tgname::text
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE NOT trigger_record.tgisinternal
        AND trigger_record.tgname LIKE 'trg_production_write_fence%'
      ORDER BY trigger_record.tgname::text
    ) AS fence_trigger_names,
    ARRAY(
      SELECT event_trigger_record.evtname::text
      FROM pg_catalog.pg_event_trigger AS event_trigger_record
      WHERE event_trigger_record.evtname LIKE 'evt_production_write_fence%'
      ORDER BY event_trigger_record.evtname::text
    ) AS fence_event_trigger_names,
    pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()')
      IS NOT NULL AS fence_guard_function_exists,
    pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()')
      IS NOT NULL AS fence_attach_function_exists,
    NOT (
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_record
        WHERE trigger_record.tgname = 'trg_production_write_fence_20260717'
          AND NOT trigger_record.tgisinternal
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_event_trigger AS event_trigger_record
        WHERE event_trigger_record.evtname = 'evt_production_write_fence_20260717'
      )
      OR pg_catalog.to_regprocedure(
        'public.production_write_fence_guard_20260717()'
      ) IS NOT NULL
      OR pg_catalog.to_regprocedure(
        'public.production_write_fence_attach_20260717()'
      ) IS NOT NULL
    ) AS production_storage_writes_allowed
), object_rows AS (
  SELECT
    object_record.bucket_id,
    object_record.name,
    COALESCE(object_record.id::text, '') AS object_id,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.to_jsonb(object_record)::text, 'UTF8'),
      'sha256'
    ), 'hex') AS row_sha256
  FROM storage.objects AS object_record
), object_catalog AS (
  SELECT
    count(*)::integer AS total_object_count,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE(
      pg_catalog.string_agg(
        object_row.row_sha256,
        '' ORDER BY object_row.bucket_id, object_row.name, object_row.object_id
      ),
      ''
    ), 'UTF8'), 'sha256'), 'hex') AS object_inventory_sha256
  FROM object_rows AS object_row
)
SELECT
  pg_catalog.statement_timestamp()::text AS observed_at,
  relation_catalog.relation_owner,
  relation_catalog.relation_rls_enabled,
  relation_catalog.relation_force_rls,
  bucket_catalog.buckets,
  policy_catalog.policies,
  helper_catalog.helper_functions,
  fence_catalog.fence_trigger_names,
  fence_catalog.fence_event_trigger_names,
  fence_catalog.fence_guard_function_exists,
  fence_catalog.fence_attach_function_exists,
  fence_catalog.production_storage_writes_allowed,
  object_catalog.total_object_count,
  object_catalog.object_inventory_sha256
FROM relation_catalog
CROSS JOIN bucket_catalog
CROSS JOIN policy_catalog
CROSS JOIN helper_catalog
CROSS JOIN fence_catalog
CROSS JOIN object_catalog
`.trim();

export class AmoraSuccessorStorageStagingProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AmoraSuccessorStorageStagingProbeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AmoraSuccessorStorageStagingProbeError(code, message);
}

function isInside(parent, child) {
  const fromParent = relative(parent, child);
  return fromParent === "" || (!fromParent.startsWith(`..${sep}`)
    && fromParent !== ".." && !isAbsolute(fromParent));
}

function canonicalPathOrFail(candidate, code, message) {
  try {
    return realpathSync(candidate);
  } catch (error) {
    if (error instanceof AmoraSuccessorStorageStagingProbeError) throw error;
    fail(code, message);
  }
}

export function assertAmoraSuccessorStorageExternalOutputPath({
  repoRoot,
  targetPath,
}) {
  if (!isAbsolute(repoRoot ?? "") || !isAbsolute(targetPath ?? "")) {
    fail("RECEIPT_PATH_INVALID", "Storage evidence paths must be absolute");
  }
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedTarget = resolve(targetPath);
  const canonicalRepoRoot = canonicalPathOrFail(
    resolvedRepoRoot,
    "RECEIPT_PATH_INVALID",
    "Storage evidence repository root could not be resolved canonically",
  );
  const canonicalParent = canonicalPathOrFail(
    dirname(resolvedTarget),
    "RECEIPT_PATH_INVALID",
    "Storage evidence parent must already exist and resolve canonically",
  );
  if (isInside(canonicalRepoRoot, canonicalParent)) {
    fail(
      "RECEIPT_INSIDE_REPOSITORY",
      "Storage evidence paths must not resolve inside the repository",
    );
  }
  try {
    const targetMetadata = lstatSync(resolvedTarget);
    if (targetMetadata.isSymbolicLink()) {
      fail(
        "RECEIPT_INSIDE_REPOSITORY",
        "Storage evidence targets must not be symbolic links or junctions",
      );
    }
    const canonicalTarget = canonicalPathOrFail(
      resolvedTarget,
      "RECEIPT_PATH_INVALID",
      "Storage evidence target could not be resolved canonically",
    );
    if (isInside(canonicalRepoRoot, canonicalTarget)) {
      fail(
        "RECEIPT_INSIDE_REPOSITORY",
        "Storage evidence paths must not resolve inside the repository",
      );
    }
  } catch (error) {
    if (error instanceof AmoraSuccessorStorageStagingProbeError) throw error;
    if (error?.code !== "ENOENT") {
      fail("RECEIPT_PATH_INVALID", "Storage evidence target could not be inspected safely");
    }
  }
  return resolvedTarget;
}

async function assertExternalHandleMatchesPath(config, targetPath, handle) {
  assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: config.repoRoot,
    targetPath,
  });
  let handleMetadata;
  let targetMetadata;
  try {
    [handleMetadata, targetMetadata] = await Promise.all([
      handle.stat(),
      lstat(targetPath),
    ]);
  } catch {
    fail("RECEIPT_PATH_INVALID", "Storage evidence target changed while it was opened");
  }
  if (!handleMetadata.isFile() || !targetMetadata.isFile()
      || targetMetadata.isSymbolicLink()
      || handleMetadata.dev !== targetMetadata.dev
      || handleMetadata.ino !== targetMetadata.ino) {
    fail("RECEIPT_PATH_INVALID", "Storage evidence target changed while it was opened");
  }
}

async function syncParentDirectory(targetPath) {
  if (process.platform === "win32") return;
  const parentDirectory = dirname(targetPath);
  let directoryHandle;
  try {
    directoryHandle = await open(parentDirectory, "r");
    await directoryHandle.sync();
  } catch {
    fail(
      "RECEIPT_DURABILITY_FAILED",
      "Storage evidence parent directory could not be synchronized durably",
    );
  } finally {
    await directoryHandle?.close();
  }
}

export function assertAmoraSuccessorStorageHostedMutationPlatform(
  runtimePlatform = process.platform,
) {
  if (runtimePlatform === "win32") {
    fail(
      "HOSTED_MUTATION_PLATFORM_UNSUPPORTED",
      "Hosted Storage mutation requires durable parent-directory synchronization unavailable on Windows",
    );
  }
}

function assertNewReceiptPathAvailable(config) {
  if (config.receiptOut === undefined) return;
  const receiptOut = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: config.repoRoot,
    targetPath: config.receiptOut,
  });
  try {
    lstatSync(receiptOut);
    fail("RECEIPT_WRITE_FAILED", "Storage staging receipt already exists");
  } catch (error) {
    if (error instanceof AmoraSuccessorStorageStagingProbeError) throw error;
    if (error?.code !== "ENOENT") {
      fail("RECEIPT_WRITE_FAILED", "Storage staging receipt availability was not provable");
    }
  }
}

function parseHostedUrl(value, code) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    fail(code, "Storage staging URL must be a canonical hosted Supabase origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port
      || url.pathname !== "/" || url.search || url.hash
      || !/^[a-z0-9]{20}\.supabase\.co$/u.test(url.hostname)) {
    fail(code, "Storage staging URL must be a canonical hosted Supabase origin");
  }
  return url;
}

export function validateAmoraSuccessorStorageStagingProbeConfig(input) {
  const projectRef = String(input?.projectRef ?? "").trim();
  const productionProjectRef = String(input?.productionProjectRef ?? "").trim();
  const approvedProjectRef = String(input?.approvedProjectRef ?? projectRef).trim();
  if (![projectRef, productionProjectRef, approvedProjectRef].every((value) => PROJECT_REF.test(value))) {
    fail("PROJECT_REF_INVALID", "Storage staging project refs must be exact 20-character refs");
  }
  if (projectRef === productionProjectRef) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "Storage upload cleanup probes are staging-only");
  }
  if (projectRef !== approvedProjectRef) {
    fail("STAGING_PROJECT_PIN_MISMATCH", "Storage probe target is not the approved staging project");
  }

  const projectUrl = parseHostedUrl(
    input?.projectUrl ?? input?.expectedUrl ?? `https://${projectRef}.supabase.co`,
    "STAGING_URL_INVALID",
  );
  const productionUrl = parseHostedUrl(
    input?.productionUrl ?? `https://${productionProjectRef}.supabase.co`,
    "PRODUCTION_URL_INVALID",
  );
  if (projectUrl.hostname !== `${projectRef}.supabase.co`
      || productionUrl.hostname !== `${productionProjectRef}.supabase.co`
      || projectUrl.origin === productionUrl.origin) {
    fail("PROJECT_HOST_MISMATCH", "Storage probe hosts do not match the pinned project refs");
  }

  const managementToken = String(input?.managementToken ?? "");
  const expectedCommit = String(input?.expectedCommit ?? "").trim();
  const repoRootRaw = String(input?.repoRoot ?? "");
  const receiptRaw = String(input?.receiptOut ?? "").trim();
  if (managementToken.length < 20 || /[\r\n]/u.test(managementToken)) {
    fail("MANAGEMENT_TOKEN_INVALID", "Storage inventory requires a bounded Management API token");
  }
  if (!COMMIT.test(expectedCommit)) {
    fail("COMMIT_INVALID", "Storage probe must bind a full lowercase commit SHA");
  }
  if (!isAbsolute(repoRootRaw) || !isAbsolute(receiptRaw)) {
    fail("RECEIPT_PATH_INVALID", "Repository and Storage receipt paths must be absolute");
  }
  const repoRoot = resolve(repoRootRaw);
  const receiptOut = resolve(receiptRaw);
  const recoveryJournalRaw = String(
    input?.recoveryJournalOut ?? `${receiptOut}.recovery.jsonl`,
  ).trim();
  if (!isAbsolute(recoveryJournalRaw)) {
    fail("RECOVERY_JOURNAL_PATH_INVALID", "Storage recovery journal path must be absolute");
  }
  const recoveryJournalOut = resolve(recoveryJournalRaw);
  if (isInside(repoRoot, receiptOut) || isInside(repoRoot, recoveryJournalOut)) {
    fail(
      "RECEIPT_INSIDE_REPOSITORY",
      "Storage staging receipts and recovery journals must stay outside the repository",
    );
  }
  if (receiptOut === recoveryJournalOut) {
    fail("RECOVERY_JOURNAL_PATH_INVALID", "Storage receipt and recovery journal paths must differ");
  }
  assertAmoraSuccessorStorageExternalOutputPath({ repoRoot, targetPath: receiptOut });
  assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot,
    targetPath: recoveryJournalOut,
  });

  return Object.freeze({
    repoRoot,
    projectRef,
    productionProjectRef,
    approvedProjectRef,
    projectUrl: projectUrl.origin,
    productionUrl: productionUrl.origin,
    managementToken,
    expectedCommit,
    receiptOut,
    recoveryJournalOut,
    expectedMigrationCount: input?.expectedMigrationCount,
    expectedMigrationHead: input?.expectedMigrationHead,
    gitOrigin: input?.gitOrigin,
  });
}

export function validateAmoraSuccessorStorageDiscoveryConfig(input) {
  const projectRef = String(input?.projectRef ?? "").trim();
  const productionProjectRef = String(input?.productionProjectRef ?? "").trim();
  const approvedProjectRef = String(input?.approvedProjectRef ?? projectRef).trim();
  if (![projectRef, productionProjectRef, approvedProjectRef]
    .every((value) => PROJECT_REF.test(value))) {
    fail(
      "PROJECT_REF_INVALID",
      "Storage discovery project refs must be exact 20-character refs",
    );
  }
  if (projectRef === productionProjectRef) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "Storage discovery is staging-only");
  }
  if (projectRef !== approvedProjectRef) {
    fail(
      "STAGING_PROJECT_PIN_MISMATCH",
      "Storage discovery target is not the approved staging project",
    );
  }

  const managementToken = String(input?.managementToken ?? "");
  const expectedCommit = String(input?.expectedCommit ?? "").trim();
  if (managementToken.length < 20 || /[\r\n]/u.test(managementToken)) {
    fail(
      "MANAGEMENT_TOKEN_INVALID",
      "Storage discovery requires a bounded Management API token",
    );
  }
  if (!COMMIT.test(expectedCommit)) {
    fail("COMMIT_INVALID", "Storage discovery must bind a full lowercase commit SHA");
  }

  let repoRoot;
  let receiptOut;
  if (input?.repoRoot !== undefined || input?.receiptOut !== undefined) {
    const repoRootRaw = String(input?.repoRoot ?? "").trim();
    const receiptRaw = String(input?.receiptOut ?? "").trim();
    if (!isAbsolute(repoRootRaw) || !isAbsolute(receiptRaw)) {
      fail("RECEIPT_PATH_INVALID", "Storage discovery receipt paths must be absolute");
    }
    repoRoot = resolve(repoRootRaw);
    receiptOut = assertAmoraSuccessorStorageExternalOutputPath({
      repoRoot,
      targetPath: resolve(receiptRaw),
    });
  }

  return Object.freeze({
    projectRef,
    productionProjectRef,
    approvedProjectRef,
    managementToken,
    expectedCommit,
    ...(repoRoot === undefined ? {} : { repoRoot, receiptOut }),
  });
}

async function boundedBody(response, code) {
  let text;
  try {
    text = await response.text();
  } catch {
    fail(code, "Storage staging response could not be read");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    fail(code, "Storage staging response exceeded the bounded size");
  }
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    fail(code, "Storage staging response was not valid JSON");
  }
}

function discoveryResultInvalid(message) {
  fail("STORAGE_DISCOVERY_RESULT_INVALID", message);
}

function normalizeDiscoveryString(value, field, {
  allowEmpty = false,
  maxLength = 512,
} = {}) {
  if (typeof value !== "string"
      || (!allowEmpty && value.length === 0)
      || value.length > maxLength
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    discoveryResultInvalid(`Storage discovery ${field} was not a bounded catalog string`);
  }
  return value;
}

function normalizeDiscoveryStringArray(value, field, {
  maxItems = MAX_DISCOVERY_LIST_ITEMS,
  maxLength = 512,
  sort = false,
} = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    discoveryResultInvalid(`Storage discovery ${field} was not a bounded catalog list`);
  }
  const normalized = value.map((entry) => normalizeDiscoveryString(entry, field, {
    maxLength,
  }));
  if (sort) normalized.sort();
  return Object.freeze(normalized);
}

function compareDiscoveryEntries(left, right, keys) {
  for (const key of keys) {
    const leftValue = String(left[key]);
    const rightValue = String(right[key]);
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

function normalizeDiscoveryBucket(bucket) {
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
    discoveryResultInvalid("Storage discovery returned an invalid bucket catalog entry");
  }
  if (typeof bucket.public !== "boolean"
      || (bucket.file_size_limit !== null
        && (!Number.isSafeInteger(bucket.file_size_limit) || bucket.file_size_limit < 0))
      || (bucket.allowed_mime_types !== null
        && !Array.isArray(bucket.allowed_mime_types))) {
    discoveryResultInvalid("Storage discovery returned an invalid bucket configuration");
  }
  const allowedMimeTypes = bucket.allowed_mime_types === null
    ? null
    : normalizeDiscoveryStringArray(
      bucket.allowed_mime_types,
      "bucket MIME type",
      { maxLength: 255 },
    );
  return Object.freeze({
    id: normalizeDiscoveryString(bucket.id, "bucket id", { maxLength: 255 }),
    name: normalizeDiscoveryString(bucket.name, "bucket name", { maxLength: 255 }),
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit,
    allowedMimeTypes,
  });
}

function normalizeDiscoveryPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    discoveryResultInvalid("Storage discovery returned an invalid policy catalog entry");
  }
  const permissive = normalizeDiscoveryString(
    policy.permissive,
    "policy permissive mode",
    { maxLength: 16 },
  );
  const command = normalizeDiscoveryString(
    policy.command,
    "policy command",
    { maxLength: 16 },
  );
  if (!["PERMISSIVE", "RESTRICTIVE"].includes(permissive)
      || !["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"].includes(command)
      || !SHA256.test(policy.using_expression_sha256 ?? "")
      || !SHA256.test(policy.with_check_expression_sha256 ?? "")
      || !SHA256.test(policy.expression_sha256 ?? "")) {
    discoveryResultInvalid("Storage discovery returned an invalid policy configuration");
  }
  return Object.freeze({
    name: normalizeDiscoveryString(policy.name, "policy name", { maxLength: 255 }),
    permissive,
    roles: normalizeDiscoveryStringArray(policy.roles, "policy role", {
      maxLength: 255,
      sort: true,
    }),
    command,
    usingExpressionSha256: policy.using_expression_sha256,
    withCheckExpressionSha256: policy.with_check_expression_sha256,
    expressionSha256: policy.expression_sha256,
  });
}

function normalizeDiscoveryHelper(helper) {
  if (!helper || typeof helper !== "object" || Array.isArray(helper)
      || typeof helper.security_definer !== "boolean"
      || typeof helper.search_path_empty !== "boolean"
      || !["IMMUTABLE", "STABLE", "VOLATILE"].includes(helper.volatility)
      || !SHA256.test(helper.config_sha256 ?? "")
      || !SHA256.test(helper.source_sha256 ?? "")) {
    discoveryResultInvalid("Storage discovery returned an invalid helper catalog entry");
  }
  return Object.freeze({
    schema: normalizeDiscoveryString(helper.schema, "helper schema", { maxLength: 255 }),
    name: normalizeDiscoveryString(helper.name, "helper name", { maxLength: 255 }),
    identityArguments: normalizeDiscoveryString(
      helper.identity_arguments,
      "helper identity arguments",
      { allowEmpty: true, maxLength: 2048 },
    ),
    owner: normalizeDiscoveryString(helper.owner, "helper owner", { maxLength: 255 }),
    securityDefiner: helper.security_definer,
    volatility: helper.volatility,
    configSha256: helper.config_sha256,
    searchPathEmpty: helper.search_path_empty,
    executeRoles: normalizeDiscoveryStringArray(helper.execute_roles, "helper execute role", {
      maxLength: 255,
      sort: true,
    }),
    sourceSha256: helper.source_sha256,
  });
}

function normalizeDiscoveryRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)
      || !Array.isArray(row.buckets) || row.buckets.length > MAX_DISCOVERY_BUCKETS
      || !Array.isArray(row.policies) || row.policies.length > MAX_DISCOVERY_POLICIES
      || !Array.isArray(row.helper_functions)
      || row.helper_functions.length > MAX_DISCOVERY_HELPERS
      || typeof row.relation_rls_enabled !== "boolean"
      || typeof row.relation_force_rls !== "boolean"
      || typeof row.fence_guard_function_exists !== "boolean"
      || typeof row.fence_attach_function_exists !== "boolean"
      || typeof row.production_storage_writes_allowed !== "boolean"
      || !Number.isSafeInteger(row.total_object_count) || row.total_object_count < 0
      || !SHA256.test(row.object_inventory_sha256 ?? "")
      || !Number.isFinite(Date.parse(row.observed_at ?? ""))) {
    discoveryResultInvalid("Hosted Storage discovery returned no single typed catalog row");
  }

  const buckets = row.buckets.map(normalizeDiscoveryBucket);
  buckets.sort((left, right) => compareDiscoveryEntries(left, right, ["id", "name"]));
  const policies = row.policies.map(normalizeDiscoveryPolicy);
  policies.sort((left, right) => compareDiscoveryEntries(
    left,
    right,
    ["name", "command", "permissive", "expressionSha256"],
  ));
  const helperFunctions = row.helper_functions.map(normalizeDiscoveryHelper);
  helperFunctions.sort((left, right) => compareDiscoveryEntries(
    left,
    right,
    ["schema", "name", "identityArguments"],
  ));

  return Object.freeze({
    observedAt: new Date(Date.parse(row.observed_at)).toISOString(),
    relationOwner: normalizeDiscoveryString(
      row.relation_owner,
      "relation owner",
      { maxLength: 255 },
    ),
    relationRlsEnabled: row.relation_rls_enabled,
    relationForceRls: row.relation_force_rls,
    buckets: Object.freeze(buckets),
    policies: Object.freeze(policies),
    helperFunctions: Object.freeze(helperFunctions),
    fence: Object.freeze({
      triggerNames: normalizeDiscoveryStringArray(
        row.fence_trigger_names,
        "fence trigger name",
        { maxLength: 255, sort: true },
      ),
      eventTriggerNames: normalizeDiscoveryStringArray(
        row.fence_event_trigger_names,
        "fence event-trigger name",
        { maxLength: 255, sort: true },
      ),
      guardFunctionExists: row.fence_guard_function_exists,
      attachFunctionExists: row.fence_attach_function_exists,
      productionStorageWritesAllowed: row.production_storage_writes_allowed,
    }),
    totalObjectCount: row.total_object_count,
    objectInventorySha256: row.object_inventory_sha256,
  });
}

function normalizeInventoryRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    fail("STORAGE_INVENTORY_RESULT_INVALID", "Hosted Storage inventory returned no single canonical row");
  }
  const counters = [
    row.total_object_count,
    row.exact_nonce_auth_user_count,
    row.exact_nonce_profile_count,
    row.exact_nonce_couple_count,
    row.exact_nonce_storage_object_count,
  ];
  const contractMatches = row.relation_owner === "supabase_storage_admin"
    && row.relation_rls_enabled === true
    && row.relation_force_rls === false
    && row.storage_bucket_count === 13
    && row.retired_guestbook_private_bucket_count === 2
    && row.bucket_contract_verified === true
    && SHA256.test(row.bucket_contract_sha256 ?? "")
    && row.storage_policy_count === 5
    && row.storage_insert_policy_count === 2
    && row.storage_policy_contract_verified === true
    && row.storage_policy_contract_sha256 === POLICY_CONTRACT_SHA256
    && row.production_storage_fence_function_verified === true
    && row.production_storage_writes_allowed === true
    && counters.every((value) => Number.isSafeInteger(value) && value >= 0)
    && SHA256.test(row.object_inventory_sha256 ?? "")
    && Number.isFinite(Date.parse(row.observed_at ?? ""))
    && row.exact_nonce_auth_user_count === 0
    && row.exact_nonce_profile_count === 0
    && row.exact_nonce_couple_count === 0
    && row.exact_nonce_storage_object_count === 0;
  if (!contractMatches) {
    fail("STORAGE_INVENTORY_CONTRACT_DRIFT", "Hosted Storage inventory drifted from the cumulative contract");
  }
  return Object.freeze({
    observedAt: new Date(Date.parse(row.observed_at)).toISOString(),
    relationOwner: row.relation_owner,
    relationRlsEnabled: row.relation_rls_enabled,
    relationForceRls: row.relation_force_rls,
    storageBucketCount: row.storage_bucket_count,
    retiredGuestbookPrivateBucketCount: row.retired_guestbook_private_bucket_count,
    bucketContractSha256: row.bucket_contract_sha256,
    storagePolicyCount: row.storage_policy_count,
    storageInsertPolicyCount: row.storage_insert_policy_count,
    storagePolicyContractSha256: row.storage_policy_contract_sha256,
    productionStorageFenceFunctionVerified:
      row.production_storage_fence_function_verified,
    productionStorageWritesAllowed: row.production_storage_writes_allowed,
    totalObjectCount: row.total_object_count,
    objectInventorySha256: row.object_inventory_sha256,
    exactNonceAuthUserCount: row.exact_nonce_auth_user_count,
    exactNonceProfileCount: row.exact_nonce_profile_count,
    exactNonceCoupleCount: row.exact_nonce_couple_count,
    exactNonceStorageObjectCount: row.exact_nonce_storage_object_count,
  });
}

export async function inspectAmoraSuccessorStorageInventory({
  projectRef,
  productionProjectRef,
  managementToken,
  runNonce,
  userId = null,
  coupleId = null,
  fetchImpl = globalThis.fetch,
}) {
  if (!PROJECT_REF.test(projectRef ?? "") || !PROJECT_REF.test(productionProjectRef ?? "")) {
    fail("PROJECT_REF_INVALID", "Storage inventory project refs were invalid");
  }
  if (projectRef === productionProjectRef) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "Storage inventory is staging-only");
  }
  if (typeof managementToken !== "string" || managementToken.length < 20
      || /[\r\n]/u.test(managementToken)
      || !RUN_NONCE.test(runNonce ?? "") || typeof fetchImpl !== "function") {
    fail("STORAGE_INVENTORY_ARGUMENT_INVALID", "Storage inventory inputs were invalid");
  }
  if ((userId !== null && !UUID.test(userId ?? ""))
      || (coupleId !== null && !UUID.test(coupleId ?? ""))) {
    fail("STORAGE_INVENTORY_ARGUMENT_INVALID", "Exact synthetic residue IDs were invalid");
  }
  const exactObjectTargets = userId !== null && coupleId !== null
    ? recoveryCandidates(probePaths({ id: userId, coupleId }, runNonce))
      .map(({ bucketId, objectPath }) => `${bucketId}\n${objectPath}`)
    : [];

  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: STORAGE_STAGING_INVENTORY_SQL,
          parameters: [runNonce, userId, coupleId, exactObjectTargets],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail("STORAGE_INVENTORY_UNAVAILABLE", "Hosted Storage inventory request failed");
  }
  const body = await boundedBody(response, "STORAGE_INVENTORY_UNAVAILABLE");
  if (response.status !== 201) {
    fail("STORAGE_INVENTORY_UNAVAILABLE", "Hosted Storage inventory request was rejected");
  }
  if (!Array.isArray(body) || body.length !== 1) {
    fail("STORAGE_INVENTORY_RESULT_INVALID", "Hosted Storage inventory returned no single canonical row");
  }
  return normalizeInventoryRow(body[0]);
}

export async function inspectAmoraSuccessorStorageDiscovery({
  config,
  fetchImpl = globalThis.fetch,
}) {
  const validatedConfig = validateAmoraSuccessorStorageDiscoveryConfig(config);
  if (typeof fetchImpl !== "function") {
    fail("STORAGE_DISCOVERY_ARGUMENT_INVALID", "Storage discovery fetch boundary was invalid");
  }

  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${validatedConfig.projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validatedConfig.managementToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: STORAGE_STAGING_DISCOVERY_SQL,
          parameters: [],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail("STORAGE_DISCOVERY_UNAVAILABLE", "Hosted Storage discovery request failed");
  }

  const body = await boundedBody(response, "STORAGE_DISCOVERY_RESULT_INVALID");
  if (response.status !== 201) {
    fail("STORAGE_DISCOVERY_UNAVAILABLE", "Hosted Storage discovery request was rejected");
  }
  if (!Array.isArray(body) || body.length !== 1) {
    discoveryResultInvalid("Hosted Storage discovery returned no single canonical row");
  }
  return normalizeDiscoveryRow(body[0]);
}

export async function runAmoraSuccessorStorageDiscovery({
  config,
  fetchImpl = globalThis.fetch,
  writeReceipt,
  now = () => new Date(),
}) {
  const validatedConfig = validateAmoraSuccessorStorageDiscoveryConfig(config);
  if (typeof fetchImpl !== "function"
      || (writeReceipt !== undefined && typeof writeReceipt !== "function")
      || typeof now !== "function") {
    fail("STORAGE_DISCOVERY_ARGUMENT_INVALID", "Storage discovery dependencies were invalid");
  }
  assertNewReceiptPathAvailable(validatedConfig);
  const capturedDate = now();
  if (!(capturedDate instanceof Date) || !Number.isFinite(capturedDate.valueOf())) {
    fail("STORAGE_DISCOVERY_CLOCK_INVALID", "Storage discovery clock was invalid");
  }

  const inventory = await inspectAmoraSuccessorStorageDiscovery({
    config: validatedConfig,
    fetchImpl,
  });
  const receipt = Object.freeze({
    receiptVersion: 1,
    kind: "amora-successor-storage-catalog-discovery",
    status: "captured_read_only",
    scope: "staging-storage-catalog-discovery-only",
    projectRef: validatedConfig.projectRef,
    gitCommit: validatedConfig.expectedCommit,
    capturedAt: capturedDate.toISOString(),
    effects: Object.freeze({
      managementReadOnlyRequests: 1,
      authMutations: 0,
      storageMutations: 0,
      productionMutations: 0,
    }),
    containsSecrets: false,
    containsRawExpressions: false,
    containsFunctionSource: false,
    containsObjectPaths: false,
    inventory,
  });
  if (writeReceipt) {
    await writeReceipt(receipt);
  } else if (validatedConfig.receiptOut !== undefined) {
    await persistReceipt(validatedConfig, receipt);
  }
  return receipt;
}

function encodeObjectPath(path) {
  if (typeof path !== "string" || path.length < 3 || path.length > 512
      || path.startsWith("/") || path.endsWith("/") || path.includes("\\")
      || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail("STORAGE_OBJECT_PATH_INVALID", "Storage probe object path was invalid");
  }
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function assertBucket(bucketId) {
  if (!ALL_PROBE_BUCKETS.has(bucketId)) {
    fail("STORAGE_BUCKET_INVALID", "Storage probe bucket was outside the bounded contract");
  }
}

function contentForBucket(bucketId) {
  if (bucketId === "community-videos") {
    return {
      bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 109, 112, 52, 50]),
      contentType: "video/mp4",
    };
  }
  return {
    bytes: Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    )),
    contentType: "image/png",
  };
}

function probeObjectId(runNonce, discriminator) {
  if (!RUN_NONCE.test(runNonce) || !/^[0-9a-f]$/u.test(discriminator)) {
    fail("RUN_NONCE_INVALID", "Storage probe nonce could not derive an object ID");
  }
  const chars = [...runNonce];
  chars[12] = "4";
  chars[16] = "8";
  chars[31] = discriminator;
  const compact = chars.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${
    compact.slice(16, 20)
  }-${compact.slice(20)}`;
}

function responseReturnedPath(body, objectPath) {
  if (Array.isArray(body)) {
    return body.some((entry) => entry?.name === objectPath
      || entry?.path === objectPath || entry?.fullPath?.endsWith(`/${objectPath}`));
  }
  return body?.path === objectPath || body?.fullPath?.endsWith(`/${objectPath}`)
    || body?.Key?.endsWith(`/${objectPath}`);
}

function isExplicitStorageDenial(response) {
  return response?.ok === false && [400, 401, 403, 404].includes(response.status);
}

export function createSupabaseStorageStagingTransport({
  projectRef,
  productionProjectRef,
  anonKey,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
}) {
  if (!PROJECT_REF.test(projectRef ?? "") || !PROJECT_REF.test(productionProjectRef ?? "")
      || projectRef === productionProjectRef
      || typeof anonKey !== "string" || anonKey.length < 8 || /[\r\n]/u.test(anonKey)
      || typeof serviceRoleKey !== "string" || serviceRoleKey.length < 8
      || /[\r\n]/u.test(serviceRoleKey) || typeof fetchImpl !== "function") {
    fail("STORAGE_TRANSPORT_CONFIG_INVALID", "Storage staging transport configuration was invalid");
  }
  const origin = `https://${projectRef}.supabase.co`;
  const productionOrigin = `https://${productionProjectRef}.supabase.co`;
  const fixtures = new Map();

  async function request(path, {
    method = "GET",
    apiKey,
    bearer,
    body,
    contentType = "application/json",
    extraHeaders = {},
    code = "STORAGE_REQUEST_FAILED",
  } = {}) {
    let url;
    try {
      url = new URL(path, origin);
    } catch {
      fail("STORAGE_REQUEST_HOST_FORBIDDEN", "Storage request URL was invalid");
    }
    if (url.origin !== origin || url.origin === productionOrigin
        || url.username || url.password || url.protocol !== "https:") {
      fail("STORAGE_REQUEST_HOST_FORBIDDEN", "Storage request escaped the staging host");
    }
    const headers = {
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
      ...extraHeaders,
    };
    let encodedBody = body;
    if (body !== undefined && !(body instanceof Uint8Array)) {
      headers["Content-Type"] = contentType;
      encodedBody = JSON.stringify(body);
    } else if (body instanceof Uint8Array) {
      headers["Content-Type"] = contentType;
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: encodedBody,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail(code, "Staging Storage request was unavailable");
    }
    const responseBody = method === "HEAD" ? null : await boundedBody(response, code);
    return Object.freeze({ status: response.status, ok: response.ok, body: responseBody });
  }

  const adminRequest = (path, options = {}) => request(path, {
    apiKey: serviceRoleKey,
    bearer: serviceRoleKey,
    ...options,
  });
  const userRequest = (user, path, options = {}) => {
    if (!UUID.test(user?.id ?? "") || typeof user?.accessToken !== "string"
        || user.accessToken.length < 8 || /[\r\n]/u.test(user.accessToken)) {
      fail("SYNTHETIC_USER_SESSION_INVALID", "Synthetic authenticated session was unavailable");
    }
    return request(path, { apiKey: anonKey, bearer: user.accessToken, ...options });
  };
  const anonRequest = (path, options = {}) => request(path, {
    apiKey: anonKey,
    bearer: anonKey,
    ...options,
  });

  function signedUrlFor({ bucketId, objectPath, token }) {
    assertBucket(bucketId);
    if (typeof token !== "string" || token.length < 3 || /[\r\n]/u.test(token)) {
      fail("SIGNED_UPLOAD_TOKEN_INVALID", "Signed upload token was invalid");
    }
    const url = new URL(
      `/storage/v1/object/upload/sign/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
      origin,
    );
    url.searchParams.set("token", token);
    return url;
  }

  function validateReturnedSignedUrl(value, bucketId, objectPath) {
    let url;
    try {
      const raw = String(value ?? "");
      url = raw.startsWith("/")
        ? new URL(raw.startsWith("/storage/v1/") ? raw : `/storage/v1${raw}`, origin)
        : new URL(raw, origin);
    } catch {
      fail("SIGNED_UPLOAD_URL_INVALID", "Signed upload URL was invalid");
    }
    if (url.origin !== origin || url.origin === productionOrigin || url.username || url.password
        || url.hash || [...url.searchParams.keys()].some((key) => key !== "token")
        || [...url.searchParams.keys()].length !== 1) {
      fail("SIGNED_UPLOAD_HOST_FORBIDDEN", "Signed upload URL escaped the staging project");
    }
    const expectedPath = signedUrlFor({
      bucketId,
      objectPath,
      token: url.searchParams.get("token") ?? "missing",
    }).pathname;
    if (url.pathname !== expectedPath || !url.searchParams.get("token")) {
      fail("SIGNED_UPLOAD_URL_INVALID", "Signed upload URL did not bind the exact object path");
    }
    return url;
  }

  async function removeObject(bucketId, objectPath) {
    const response = await adminRequest(`/storage/v1/object/${encodeURIComponent(bucketId)}`, {
      method: "DELETE",
      body: { prefixes: [objectPath] },
      code: "STORAGE_OBJECT_CLEANUP_FAILED",
    });
    return response.ok && responseReturnedPath(response.body, objectPath);
  }

  async function objectAbsent(bucketId, objectPath) {
    const response = await adminRequest(
      `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
      { method: "HEAD", code: "STORAGE_OBJECT_EXISTENCE_CHECK_FAILED" },
    );
    return response.status === 400 || response.status === 404;
  }

  return Object.freeze({
    async createSyntheticUser(label) {
      if (typeof label !== "string" || label.length < 16 || label.length > 160
          || /[\r\n]/u.test(label)) {
        fail("SYNTHETIC_USER_LABEL_INVALID", "Synthetic Storage label was invalid");
      }
      const email = `${label}-${randomBytes(6).toString("hex")}@hanbang-test.invalid`;
      const password = `${randomBytes(24).toString("base64url")}!Aa1`;
      const created = await adminRequest("/auth/v1/admin/users", {
        method: "POST",
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: { name: label },
        },
        code: "SYNTHETIC_USER_CREATE_FAILED",
      });
      const id = created.body?.id ?? created.body?.user?.id;
      if (!created.ok || !UUID.test(id ?? "")) {
        fail("SYNTHETIC_USER_CREATE_FAILED", "Synthetic Storage user could not be created");
      }
      try {
        const session = await anonRequest("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: { email, password },
          code: "SYNTHETIC_USER_LOGIN_FAILED",
        });
        const accessToken = session.body?.access_token;
        if (!session.ok || session.body?.user?.id !== id
            || typeof accessToken !== "string" || accessToken.length < 16) {
          fail("SYNTHETIC_USER_LOGIN_FAILED", "Synthetic Storage user could not authenticate");
        }
        const user = { id, accessToken };
        const preparation = await userRequest(
          user,
          "/rest/v1/rpc/create_neutral_preparation_space_for_current_user",
          { method: "POST", body: {}, code: "SYNTHETIC_COUPLE_CREATE_FAILED" },
        );
        const coupleId = preparation.body?.couple_id;
        if (!preparation.ok || preparation.body?.success !== true || !UUID.test(coupleId ?? "")) {
          fail("SYNTHETIC_COUPLE_CREATE_FAILED", "Synthetic neutral preparation space was invalid");
        }
        fixtures.set(id, { coupleId, accessToken });
        return Object.freeze({ id, coupleId, accessToken });
      } catch (error) {
        try {
          await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
            method: "DELETE",
            code: "SYNTHETIC_USER_CLEANUP_FAILED",
          });
        } catch {
          // The final Management inventory remains the authoritative residue check.
        }
        throw error;
      }
    },

    async createSignedUpload({ user, bucketId, objectPath }) {
      if (!UUID.test(user?.id ?? "")) {
        fail("SYNTHETIC_USER_INVALID", "Synthetic Storage user was invalid");
      }
      if (bucketId !== "community-media-staging") {
        fail("STORAGE_BUCKET_INVALID", "Signed upload creation must target the staging bucket");
      }
      const response = await adminRequest(
        `/storage/v1/object/upload/sign/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
        {
          method: "POST",
          body: {},
          extraHeaders: { "x-upsert": "false" },
          code: "SIGNED_UPLOAD_CREATE_FAILED",
        },
      );
      if (!response.ok) {
        fail("SIGNED_UPLOAD_CREATE_FAILED", "Exact staging signed upload could not be created");
      }
      const returnedUrl = response.body?.signedUrl ?? response.body?.url;
      const signedUrl = validateReturnedSignedUrl(returnedUrl, bucketId, objectPath);
      const token = response.body?.token ?? signedUrl.searchParams.get("token");
      if (typeof token !== "string" || token.length < 3
          || token !== signedUrl.searchParams.get("token")) {
        fail("SIGNED_UPLOAD_TOKEN_INVALID", "Signed upload token was invalid");
      }
      return Object.freeze({ bucketId, objectPath, token, signedUrl: signedUrl.toString() });
    },

    async uploadSignedObject({ signedUpload, bucketId, objectPath, contentType, bytes }) {
      const signedUrl = validateReturnedSignedUrl(signedUpload?.signedUrl, bucketId, objectPath);
      if (signedUpload?.bucketId !== bucketId || signedUpload?.objectPath !== objectPath
          || signedUpload?.token !== signedUrl.searchParams.get("token")
          || typeof contentType !== "string" || !(bytes instanceof Uint8Array)) {
        fail("SIGNED_UPLOAD_ARGUMENT_INVALID", "Signed upload arguments were invalid");
      }
      const response = await anonRequest(signedUrl.toString(), {
        method: "PUT",
        body: bytes,
        contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "SIGNED_UPLOAD_FAILED",
      });
      return Object.freeze({ uploaded: response.ok });
    },

    async attemptSignedUploadAtDifferentPath({ signedUpload, objectPath, differentObjectPath }) {
      if (signedUpload?.objectPath !== objectPath || objectPath === differentObjectPath) {
        fail("SIGNED_UPLOAD_ARGUMENT_INVALID", "Signed path-binding arguments were invalid");
      }
      const content = contentForBucket(signedUpload.bucketId);
      const differentUrl = signedUrlFor({
        bucketId: signedUpload.bucketId,
        objectPath: differentObjectPath,
        token: signedUpload.token,
      });
      const response = await anonRequest(differentUrl.toString(), {
        method: "PUT",
        body: content.bytes,
        contentType: content.contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "SIGNED_UPLOAD_DIFFERENT_PATH_CHECK_FAILED",
      });
      return Object.freeze({ denied: isExplicitStorageDenial(response) });
    },

    async attemptUnsignedMutation({ actor, user, bucketId, objectPath }) {
      if (!ACTORS.includes(actor)) {
        fail("STORAGE_MUTATION_ACTOR_INVALID", "Unsigned Storage actor was invalid");
      }
      assertBucket(bucketId);
      const content = contentForBucket(bucketId);
      const call = actor === "authenticated"
        ? (path, options) => userRequest(user, path, options)
        : anonRequest;
      const exactPath = `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`;
      const upload = await call(exactPath, {
        method: "POST",
        body: content.bytes,
        contentType: content.contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "UNSIGNED_STORAGE_CHECK_FAILED",
      });
      const update = await call(exactPath, {
        method: "PUT",
        body: content.bytes,
        contentType: content.contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "UNSIGNED_STORAGE_CHECK_FAILED",
      });
      const removal = await call(`/storage/v1/object/${encodeURIComponent(bucketId)}`, {
        method: "DELETE",
        body: { prefixes: [objectPath] },
        code: "UNSIGNED_STORAGE_CHECK_FAILED",
      });
      return Object.freeze({
        denied: [upload, update, removal].every(isExplicitStorageDenial),
      });
    },

    async verifyChatBoundary({
      user,
      bucketId,
      ownObjectPath,
      anonObjectPath,
      wrongCoupleObjectPath,
      wrongUploaderObjectPath,
      malformedObjectPath,
    }) {
      if (bucketId !== "chat-image") {
        fail("STORAGE_BUCKET_INVALID", "Chat boundary must target chat-image");
      }
      if (!UUID.test(user?.coupleId ?? "")
          || !ownObjectPath.startsWith(`${user.coupleId}/${user.id}/`)
          || !anonObjectPath.startsWith(`${user.coupleId}/${user.id}/`)
          || !wrongCoupleObjectPath.startsWith(`${OTHER_COUPLE_ID}/${user.id}/`)
          || !wrongUploaderObjectPath.startsWith(`${user.coupleId}/${OTHER_USER_ID}/`)
          || new Set([
            ownObjectPath,
            anonObjectPath,
            wrongCoupleObjectPath,
            wrongUploaderObjectPath,
            malformedObjectPath,
          ]).size !== 5) {
        fail("CHAT_BOUNDARY_ARGUMENT_INVALID", "Chat boundary paths were not canonical");
      }
      const content = contentForBucket(bucketId);
      const upload = async (actor, objectPath) => {
        const call = actor === "authenticated"
          ? (path, options) => userRequest(user, path, options)
          : anonRequest;
        return call(
          `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
          {
            method: "POST",
            body: content.bytes,
            contentType: content.contentType,
            extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
            code: "CHAT_STORAGE_BOUNDARY_CHECK_FAILED",
          },
        );
      };
      const ownInsert = await upload("authenticated", ownObjectPath);
      const anonInsert = await upload("anon", anonObjectPath);
      const wrongCoupleInsert = await upload("authenticated", wrongCoupleObjectPath);
      const wrongUploaderInsert = await upload("authenticated", wrongUploaderObjectPath);
      const malformedInsert = await upload("authenticated", malformedObjectPath);
      const read = await userRequest(
        user,
        `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(ownObjectPath)}`,
        { method: "GET", code: "CHAT_STORAGE_BOUNDARY_CHECK_FAILED" },
      );
      const update = await userRequest(
        user,
        `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(ownObjectPath)}`,
        {
          method: "PUT",
          body: content.bytes,
          contentType: content.contentType,
          extraHeaders: { "cache-control": "max-age=0", "x-upsert": "true" },
          code: "CHAT_STORAGE_BOUNDARY_CHECK_FAILED",
        },
      );
      const removal = await userRequest(
        user,
        `/storage/v1/object/${encodeURIComponent(bucketId)}`,
        {
          method: "DELETE",
          body: { prefixes: [ownObjectPath] },
          code: "CHAT_STORAGE_BOUNDARY_CHECK_FAILED",
        },
      );
      return Object.freeze({
        ownInsertSucceeded: ownInsert.ok && responseReturnedPath(ownInsert.body, ownObjectPath),
        anonInsertDenied: isExplicitStorageDenial(anonInsert),
        wrongCoupleDenied: isExplicitStorageDenial(wrongCoupleInsert),
        wrongUploaderDenied: isExplicitStorageDenial(wrongUploaderInsert),
        malformedPathDenied: isExplicitStorageDenial(malformedInsert),
        readDenied: isExplicitStorageDenial(read),
        updateDenied: isExplicitStorageDenial(update),
        deleteDenied: isExplicitStorageDenial(removal),
      });
    },

    async deleteExactObject({ bucketId, objectPath }) {
      assertBucket(bucketId);
      const deleted = await removeObject(bucketId, objectPath);
      const absent = await objectAbsent(bucketId, objectPath);
      return Object.freeze({ deleted, absent });
    },

    async deleteSyntheticUser(userId) {
      if (!UUID.test(userId ?? "")) {
        fail("SYNTHETIC_USER_INVALID", "Synthetic Storage user ID was invalid");
      }
      const fixture = fixtures.get(userId);
      if (!UUID.test(fixture?.coupleId ?? "")
          || typeof fixture?.accessToken !== "string" || fixture.accessToken.length < 8) {
        fail("SYNTHETIC_USER_SESSION_INVALID", "Synthetic cleanup session was unavailable");
      }
      const reset = await userRequest(
        { id: userId, accessToken: fixture.accessToken },
        "/rest/v1/rpc/reset_current_couple_membership",
        { method: "POST", body: {}, code: "SYNTHETIC_USER_CLEANUP_FAILED" },
      );
      if (!reset.ok || reset.body?.success !== true
          || reset.body?.previous_couple_id !== fixture.coupleId) {
        return Object.freeze({ deleted: false });
      }
      const account = await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        code: "SYNTHETIC_USER_CLEANUP_FAILED",
      });
      if (account.ok) fixtures.delete(userId);
      return Object.freeze({ deleted: account.ok });
    },

    async discoverSyntheticRecoveryTarget({ identityLabel }) {
      if (typeof identityLabel !== "string"
          || !/^amora-storage-[a-f0-9]{32}$/u.test(identityLabel)) {
        fail("RECOVERY_TARGET_INVALID", "Synthetic Storage recovery label was invalid");
      }
      const listed = await adminRequest("/auth/v1/admin/users?page=1&per_page=1000", {
        method: "GET",
        code: "SYNTHETIC_USER_RECOVERY_DISCOVERY_FAILED",
      });
      const users = Array.isArray(listed.body) ? listed.body : listed.body?.users;
      if (!listed.ok || !Array.isArray(users) || users.length > 1000) {
        fail("SYNTHETIC_USER_RECOVERY_DISCOVERY_FAILED", "Synthetic recovery user list was not bounded");
      }
      const matches = users.filter((account) => {
        const label = account?.user_metadata?.name ?? account?.raw_user_meta_data?.name;
        return UUID.test(account?.id ?? "")
          && label === identityLabel
          && typeof account?.email === "string"
          && account.email.startsWith(`${identityLabel}-`)
          && account.email.endsWith("@hanbang-test.invalid");
      });
      if (matches.length === 0) return Object.freeze({ absent: true });
      if (matches.length !== 1) {
        fail("RECOVERY_IDENTITY_AMBIGUOUS", "Deterministic Storage recovery identity was not unique");
      }
      const userId = matches[0].id;
      const query = new URLSearchParams({
        select: "id,couple_id",
        id: `eq.${userId}`,
        limit: "2",
      });
      const profiles = await adminRequest(`/rest/v1/profiles?${query.toString()}`, {
        method: "GET",
        code: "SYNTHETIC_USER_RECOVERY_DISCOVERY_FAILED",
      });
      if (!profiles.ok || !Array.isArray(profiles.body) || profiles.body.length > 1
          || (profiles.body.length === 1 && (
            profiles.body[0]?.id !== userId
            || (profiles.body[0]?.couple_id !== null
              && !UUID.test(profiles.body[0]?.couple_id ?? ""))
          ))) {
        fail("SYNTHETIC_USER_RECOVERY_DISCOVERY_FAILED", "Synthetic recovery profile was not exact");
      }
      return Object.freeze({ userId, coupleId: profiles.body[0]?.couple_id ?? null });
    },

    async recoverSyntheticUser({ userId, coupleId, identityLabel }) {
      if (!UUID.test(userId ?? "") || (coupleId !== null && !UUID.test(coupleId ?? ""))
          || typeof identityLabel !== "string" || identityLabel.length < 16
          || identityLabel.length > 160 || /[\r\n]/u.test(identityLabel)) {
        fail("RECOVERY_TARGET_INVALID", "Synthetic Storage recovery target was invalid");
      }
      const lookup = await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "GET",
        code: "SYNTHETIC_USER_RECOVERY_FAILED",
      });
      if (lookup.status === 404) {
        return Object.freeze({ deleted: true, absent: true });
      }
      const account = lookup.body?.user ?? lookup.body;
      const email = account?.email;
      const label = account?.user_metadata?.name ?? account?.raw_user_meta_data?.name;
      if (!lookup.ok || account?.id !== userId || label !== identityLabel
          || typeof email !== "string" || /[\r\n]/u.test(email)
          || !email.startsWith(`${identityLabel}-`)
          || !email.endsWith("@hanbang-test.invalid")) {
        fail("RECOVERY_IDENTITY_MISMATCH", "Synthetic Storage recovery identity did not match");
      }

      const password = `${randomBytes(24).toString("base64url")}!Aa1`;
      const updated = await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        body: { password },
        code: "SYNTHETIC_USER_RECOVERY_FAILED",
      });
      if (!updated.ok || (updated.body?.id ?? updated.body?.user?.id) !== userId) {
        fail("SYNTHETIC_USER_RECOVERY_FAILED", "Synthetic recovery session could not be prepared");
      }
      const session = await anonRequest("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password },
        code: "SYNTHETIC_USER_RECOVERY_FAILED",
      });
      const accessToken = session.body?.access_token;
      if (!session.ok || session.body?.user?.id !== userId
          || typeof accessToken !== "string" || accessToken.length < 16) {
        fail("SYNTHETIC_USER_RECOVERY_FAILED", "Synthetic recovery session was not issued");
      }
      const reset = await userRequest(
        { id: userId, accessToken },
        "/rest/v1/rpc/reset_current_couple_membership",
        { method: "POST", body: {}, code: "SYNTHETIC_USER_RECOVERY_FAILED" },
      );
      if (!reset.ok || reset.body?.success !== true
          || (coupleId === null
            ? reset.body?.previous_couple_id !== null
            : ![coupleId, null].includes(reset.body?.previous_couple_id))) {
        return Object.freeze({ deleted: false });
      }
      const deleted = await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        code: "SYNTHETIC_USER_RECOVERY_FAILED",
      });
      return Object.freeze({ deleted: deleted.ok });
    },
  });
}

function assertNormalizedInventory(inventory) {
  if (!inventory || typeof inventory !== "object"
      || inventory.relationOwner !== "supabase_storage_admin"
      || inventory.relationRlsEnabled !== true
      || inventory.relationForceRls !== false
      || inventory.storageBucketCount !== 13
      || inventory.retiredGuestbookPrivateBucketCount !== 2
      || !SHA256.test(inventory.bucketContractSha256 ?? "")
      || inventory.storagePolicyCount !== 5
      || inventory.storageInsertPolicyCount !== 2
      || inventory.storagePolicyContractSha256 !== POLICY_CONTRACT_SHA256
      || inventory.productionStorageFenceFunctionVerified !== true
      || inventory.productionStorageWritesAllowed !== true
      || !Number.isSafeInteger(inventory.totalObjectCount) || inventory.totalObjectCount < 0
      || !SHA256.test(inventory.objectInventorySha256 ?? "")
      || !Number.isFinite(Date.parse(inventory.observedAt ?? ""))
      || ![
        inventory.exactNonceAuthUserCount,
        inventory.exactNonceProfileCount,
        inventory.exactNonceCoupleCount,
        inventory.exactNonceStorageObjectCount,
      ].every((value) => value === 0)) {
    fail("STORAGE_INVENTORY_CONTRACT_DRIFT", "Injected Storage inventory was not canonical");
  }
  return inventory;
}

function stableSemantics(baseline, finalInventory) {
  return baseline.bucketContractSha256 === finalInventory.bucketContractSha256
    && baseline.storagePolicyContractSha256 === finalInventory.storagePolicyContractSha256
    && baseline.storageBucketCount === finalInventory.storageBucketCount
    && baseline.retiredGuestbookPrivateBucketCount
      === finalInventory.retiredGuestbookPrivateBucketCount
    && baseline.storagePolicyCount === finalInventory.storagePolicyCount
    && baseline.storageInsertPolicyCount === finalInventory.storageInsertPolicyCount
    && baseline.productionStorageFenceFunctionVerified
      === finalInventory.productionStorageFenceFunctionVerified
    && baseline.productionStorageWritesAllowed
      === finalInventory.productionStorageWritesAllowed;
}

function probePaths(user, runNonce) {
  const unsigned = UNSIGNED_BUCKETS.flatMap((bucketId) => ACTORS.map((actor) => ({
    kind: `unsigned-${actor}`,
    actor,
    bucketId,
    objectPath: `${user.id}/${runNonce}-unsigned-${actor}-${bucketId}.${
      bucketId === "community-videos" ? "mp4" : "png"
    }`,
  })));
  const chatObjectIds = ["1", "2", "3", "4", "5"].map(
    (discriminator) => probeObjectId(runNonce, discriminator),
  );
  return Object.freeze({
    signed: Object.freeze({
      kind: "signed-original",
      bucketId: "community-media-staging",
      objectPath: `${user.id}/${runNonce}-signed.png`,
    }),
    differentSigned: Object.freeze({
      kind: "signed-different-path",
      bucketId: "community-media-staging",
      objectPath: `${user.id}/${runNonce}-signed-different.png`,
    }),
    unsigned: Object.freeze(unsigned),
    chat: Object.freeze({
      bucketId: "chat-image",
      own: Object.freeze({
        kind: "chat-own",
        bucketId: "chat-image",
        objectPath: `${user.coupleId}/${user.id}/${chatObjectIds[0]}.png`,
      }),
      anon: Object.freeze({
        kind: "chat-anon",
        bucketId: "chat-image",
        objectPath: `${user.coupleId}/${user.id}/${chatObjectIds[1]}.png`,
      }),
      wrongCouple: Object.freeze({
        kind: "chat-wrong-couple",
        bucketId: "chat-image",
        objectPath: `${OTHER_COUPLE_ID}/${user.id}/${chatObjectIds[2]}.png`,
      }),
      wrongUploader: Object.freeze({
        kind: "chat-wrong-uploader",
        bucketId: "chat-image",
        objectPath: `${user.coupleId}/${OTHER_USER_ID}/${chatObjectIds[3]}.png`,
      }),
      malformed: Object.freeze({
        kind: "chat-malformed",
        bucketId: "chat-image",
        objectPath: `${user.coupleId}/${user.id}/extra/${chatObjectIds[4]}.png`,
      }),
    }),
  });
}

async function persistReceipt(config, receipt) {
  const receiptOut = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: config.repoRoot,
    targetPath: config.receiptOut,
  });
  let handle;
  try {
    handle = await open(receiptOut, "wx", 0o600);
    await assertExternalHandleMatchesPath(config, receiptOut, handle);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
    });
    await handle.sync();
    await syncParentDirectory(receiptOut);
  } catch {
    fail("RECEIPT_WRITE_FAILED", "Storage staging receipt could not be written exclusively");
  } finally {
    await handle?.close();
  }
}

function recoveryIdentityMarker(config, runNonce) {
  return createHash("sha256")
    .update([
      "amora-successor-storage-staging-recovery-v1",
      config.projectRef,
      config.expectedCommit,
      runNonce,
    ].join("\n"), "utf8")
    .digest("hex");
}

async function createRecoveryJournal(config, runNonce, startedDate) {
  const journal = Object.freeze({
    journalVersion: 1,
    kind: "amora-successor-storage-staging-recovery",
    status: "incomplete",
    projectRef: config.projectRef,
    gitCommit: config.expectedCommit,
    runNonce,
    identityMarker: recoveryIdentityMarker(config, runNonce),
    startedAt: startedDate.toISOString(),
    userId: null,
    coupleId: null,
    candidates: Object.freeze([]),
  });
  const recoveryJournalOut = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: config.repoRoot,
    targetPath: config.recoveryJournalOut,
  });
  let handle;
  try {
    handle = await open(recoveryJournalOut, "wx", 0o600);
    await assertExternalHandleMatchesPath(config, recoveryJournalOut, handle);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(journal)}\n`, { encoding: "utf8" });
    await handle.sync();
    await syncParentDirectory(recoveryJournalOut);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail(
        "RECOVERY_JOURNAL_EXISTS",
        "An incomplete Storage recovery journal blocks a new staging run",
      );
    }
    fail("RECOVERY_JOURNAL_WRITE_FAILED", "Storage recovery journal could not be created exclusively");
  } finally {
    await handle?.close();
  }
  return journal;
}

async function appendRecoveryJournal(config, journal) {
  const recoveryJournalOut = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: config.repoRoot,
    targetPath: config.recoveryJournalOut,
  });
  let handle;
  try {
    handle = await open(
      recoveryJournalOut,
      constants.O_RDWR | constants.O_APPEND,
      0o600,
    );
    await assertExternalHandleMatchesPath(config, recoveryJournalOut, handle);
    const metadata = await handle.stat();
    if (metadata.size < 1 || metadata.size > MAX_RECOVERY_JOURNAL_BYTES
        || (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o600)) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal was not appendable safely");
    }
    const text = await handle.readFile({ encoding: "utf8" });
    if (!text.endsWith("\n")) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal had an incomplete append");
    }
    const records = text.trimEnd().split("\n");
    if (records.length < 1 || records.length >= 4) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal record count was not bounded");
    }
    let first;
    let latest;
    for (const [index, record] of records.entries()) {
      let current;
      try {
        current = validateRecoveryJournal(config, JSON.parse(record));
      } catch (error) {
        if (error instanceof AmoraSuccessorStorageStagingProbeError) throw error;
        fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal was not valid JSON Lines");
      }
      first ??= current;
      assertRecoveryJournalTransition(first, latest ?? current, current, index);
      latest = current;
    }
    const next = validateRecoveryJournal(config, journal);
    assertRecoveryJournalTransition(first, latest, next, records.length);
    await handle.writeFile(`${JSON.stringify(journal)}\n`, { encoding: "utf8" });
    await handle.sync();
  } catch (error) {
    if (error instanceof AmoraSuccessorStorageStagingProbeError) throw error;
    fail("RECOVERY_JOURNAL_WRITE_FAILED", "Storage recovery journal could not be advanced");
  } finally {
    await handle?.close();
  }
}

function recoveryCandidates(paths) {
  if (!paths) return Object.freeze([]);
  const candidates = [
    paths.signed,
    paths.differentSigned,
    ...paths.unsigned,
    paths.chat.own,
    paths.chat.anon,
    paths.chat.wrongCouple,
    paths.chat.wrongUploader,
    paths.chat.malformed,
  ];
  return Object.freeze([...new Map(candidates.map((candidate) => [
    `${candidate.bucketId}\n${candidate.objectPath}`,
    Object.freeze({
      kind: candidate.kind,
      bucketId: candidate.bucketId,
      objectPath: candidate.objectPath,
    }),
  ])).values()]);
}

async function removeRecoveryJournal(config) {
  const recoveryJournalOut = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: config.repoRoot,
    targetPath: config.recoveryJournalOut,
  });
  try {
    await unlink(recoveryJournalOut);
    await syncParentDirectory(recoveryJournalOut);
  } catch {
    fail("RECOVERY_JOURNAL_REMOVE_FAILED", "Completed Storage recovery journal could not be removed");
  }
}

function assertRecoveryJournalValueSafe(value) {
  if (typeof value === "string") {
    if (/[?&]token=|password=|\/object\/upload\/sign\//iu.test(value)) {
      fail("RECOVERY_JOURNAL_SECRET_FIELD", "Storage recovery journal contained secret material");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertRecoveryJournalValueSafe(entry);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/token|password|signedurl/iu.test(key)) {
      fail("RECOVERY_JOURNAL_SECRET_FIELD", "Storage recovery journal contained a forbidden field");
    }
    assertRecoveryJournalValueSafe(child);
  }
}

function validateRecoveryJournal(config, journal) {
  assertRecoveryJournalValueSafe(journal);
  const exactKeys = [
    "candidates",
    "coupleId",
    "gitCommit",
    "identityMarker",
    "journalVersion",
    "kind",
    "projectRef",
    "runNonce",
    "startedAt",
    "status",
    "userId",
  ];
  if (!journal || typeof journal !== "object" || Array.isArray(journal)
      || JSON.stringify(Object.keys(journal).sort()) !== JSON.stringify(exactKeys)
      || journal.journalVersion !== 1
      || journal.kind !== "amora-successor-storage-staging-recovery"
      || journal.status !== "incomplete"
      || journal.projectRef !== config.projectRef
      || journal.gitCommit !== config.expectedCommit
      || !RUN_NONCE.test(journal.runNonce ?? "")
      || journal.identityMarker !== recoveryIdentityMarker(config, journal.runNonce)
      || !Number.isFinite(Date.parse(journal.startedAt ?? ""))
      || !Array.isArray(journal.candidates) || journal.candidates.length > 32) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal did not match the pinned run");
  }
  const idsAreNull = journal.userId === null && journal.coupleId === null;
  const userOnlyIsExact = UUID.test(journal.userId ?? "") && journal.coupleId === null;
  const idsAreExact = UUID.test(journal.userId ?? "") && UUID.test(journal.coupleId ?? "");
  if (!idsAreNull && !userOnlyIsExact && !idsAreExact) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal IDs were not canonical");
  }
  const uniqueTargets = new Set();
  for (const candidate of journal.candidates) {
    const keys = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? Object.keys(candidate).sort()
      : [];
    if (JSON.stringify(keys) !== JSON.stringify(["bucketId", "kind", "objectPath"])
        || typeof candidate.kind !== "string" || candidate.kind.length < 1
        || candidate.kind.length > 64 || /[\r\n]/u.test(candidate.kind)
        || !ALL_PROBE_BUCKETS.has(candidate.bucketId)
        || typeof candidate.objectPath !== "string" || candidate.objectPath.length < 1
        || candidate.objectPath.length > 512 || /[\r\n]/u.test(candidate.objectPath)
        || candidate.objectPath.split("/").some((part) => part === "" || part === "." || part === "..")) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal target was not bounded");
    }
    uniqueTargets.add(`${candidate.bucketId}\n${candidate.objectPath}`);
  }
  if (uniqueTargets.size !== journal.candidates.length
      || ((idsAreNull || userOnlyIsExact) && journal.candidates.length !== 0)
      || (idsAreExact && journal.candidates.length === 0)) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal targets were incomplete or duplicated");
  }
  if (idsAreExact) {
    const serializeCandidate = ({ kind, bucketId, objectPath }) =>
      `${kind}\n${bucketId}\n${objectPath}`;
    const actualCandidates = journal.candidates.map(serializeCandidate).sort();
    const expectedCandidates = recoveryCandidates(probePaths({
      id: journal.userId,
      coupleId: journal.coupleId,
    }, journal.runNonce)).map(serializeCandidate).sort();
    if (JSON.stringify(actualCandidates) !== JSON.stringify(expectedCandidates)) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal targets did not match the pinned run");
    }
  }
  return Object.freeze({
    ...journal,
    candidates: Object.freeze(journal.candidates.map((candidate) => Object.freeze({ ...candidate }))),
  });
}

function assertRecoveryJournalTransition(first, previous, current, index) {
  const immutableFields = [
    "journalVersion",
    "kind",
    "status",
    "projectRef",
    "gitCommit",
    "runNonce",
    "identityMarker",
    "startedAt",
  ];
  if (immutableFields.some((field) => current[field] !== first[field])) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal mixed different runs");
  }
  if (index === 0) {
    if (current.userId !== null || current.coupleId !== null
        || current.candidates.length !== 0) {
      fail(
        "RECOVERY_JOURNAL_INVALID",
        "Storage recovery journal did not start from the fsynced pre-mutation state",
      );
    }
    return;
  }
  if ((previous.userId !== null && current.userId !== previous.userId)
      || (previous.coupleId !== null && current.coupleId !== previous.coupleId)) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal identity regressed or changed");
  }
  if (previous.userId === null && current.userId === null) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal repeated an empty state");
  }
  if (previous.coupleId !== null && current.coupleId === null) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal couple identity regressed");
  }
  if (previous.candidates.length > 0) {
    if (JSON.stringify(current.candidates) !== JSON.stringify(previous.candidates)) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal targets changed after sealing");
    }
  } else if (current.coupleId === null && current.candidates.length !== 0) {
    fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal targets preceded couple binding");
  }
}

async function readRecoveryJournal(config) {
  let handle;
  try {
    const recoveryJournalOut = assertAmoraSuccessorStorageExternalOutputPath({
      repoRoot: config.repoRoot,
      targetPath: config.recoveryJournalOut,
    });
    handle = await open(recoveryJournalOut, "r+");
    await assertExternalHandleMatchesPath(config, recoveryJournalOut, handle);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_RECOVERY_JOURNAL_BYTES) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal size was not bounded");
    }
    if (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o600) {
      fail("RECOVERY_JOURNAL_PERMISSIONS_INVALID", "Storage recovery journal was not mode 0600");
    }
    let text = await readFile(handle, { encoding: "utf8" });
    let tornTail = false;
    if (!text.endsWith("\n")) {
      const lastCompleteBoundary = text.lastIndexOf("\n");
      if (lastCompleteBoundary < 0) {
        fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal had no complete record");
      }
      text = text.slice(0, lastCompleteBoundary + 1);
      tornTail = true;
    }
    const records = text.trimEnd().split("\n");
    if (records.length < 1 || records.length > 4) {
      fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal record count was not bounded");
    }
    let first;
    let latest;
    for (const [index, record] of records.entries()) {
      try {
        const current = validateRecoveryJournal(config, JSON.parse(record));
        first ??= current;
        assertRecoveryJournalTransition(first, latest ?? current, current, index);
        latest = current;
      } catch (error) {
        if (error instanceof AmoraSuccessorStorageStagingProbeError) throw error;
        fail("RECOVERY_JOURNAL_INVALID", "Storage recovery journal was not valid JSON Lines");
      }
    }
    if (tornTail) {
      await handle.truncate(Buffer.byteLength(text, "utf8"));
      await handle.sync();
    }
    return latest;
  } catch (error) {
    if (error instanceof AmoraSuccessorStorageStagingProbeError) throw error;
    if (error?.code === "ENOENT") {
      fail("RECOVERY_JOURNAL_MISSING", "No incomplete Storage recovery journal exists");
    }
    fail("RECOVERY_JOURNAL_READ_FAILED", "Storage recovery journal could not be read");
  } finally {
    await handle?.close();
  }
}

export async function recoverAmoraSuccessorStorageStagingProbe({
  config,
  transport,
  inspectInventory,
  now = () => new Date(),
  runtimePlatform = process.platform,
}) {
  if (!config || typeof transport !== "object" || typeof transport.deleteExactObject !== "function"
      || typeof transport.recoverSyntheticUser !== "function"
      || typeof inspectInventory !== "function" || typeof now !== "function") {
    fail("RECOVERY_ARGUMENT_INVALID", "Storage recovery dependencies were invalid");
  }
  assertAmoraSuccessorStorageHostedMutationPlatform(runtimePlatform);
  const journal = await readRecoveryJournal(config);
  let recoveryJournal = journal;
  if (journal.userId === null && journal.coupleId === null && journal.candidates.length === 0) {
    if (typeof transport.discoverSyntheticRecoveryTarget !== "function") {
      fail(
        "RECOVERY_JOURNAL_TARGETS_INCOMPLETE",
        "Storage recovery transport cannot resolve the deterministic journal identity",
      );
    }
    const discovered = await transport.discoverSyntheticRecoveryTarget({
      identityLabel: `amora-storage-${journal.runNonce}`,
    });
    if (discovered?.absent === true) {
      recoveryJournal = journal;
    } else if (UUID.test(discovered?.userId ?? "")
        && (discovered?.coupleId === null || UUID.test(discovered?.coupleId ?? ""))) {
      const candidates = discovered.coupleId === null
        ? Object.freeze([])
        : recoveryCandidates(probePaths({
          id: discovered.userId,
          coupleId: discovered.coupleId,
        }, journal.runNonce));
      recoveryJournal = Object.freeze({
        ...journal,
        userId: discovered.userId,
        coupleId: discovered.coupleId,
        candidates,
      });
      await appendRecoveryJournal(config, recoveryJournal);
    } else {
      fail("RECOVERY_TARGET_INVALID", "Deterministic Storage recovery identity was ambiguous");
    }
  } else if (!UUID.test(journal.userId ?? "")
      || (journal.coupleId !== null && !UUID.test(journal.coupleId ?? ""))
      || (journal.coupleId === null
        ? journal.candidates.length !== 0
        : journal.candidates.length === 0)) {
    fail("RECOVERY_JOURNAL_TARGETS_INCOMPLETE", "Storage recovery targets were incomplete");
  }

  const failures = [];
  for (const candidate of recoveryJournal.candidates) {
    try {
      const cleaned = await transport.deleteExactObject(candidate);
      if (cleaned?.absent !== true) failures.push("object");
    } catch {
      failures.push("object");
    }
  }
  if (recoveryJournal.userId !== null) {
    try {
      const recovered = await transport.recoverSyntheticUser({
        userId: recoveryJournal.userId,
        coupleId: recoveryJournal.coupleId,
        identityLabel: `amora-storage-${journal.runNonce}`,
      });
      if (recovered?.deleted !== true) failures.push("user");
    } catch {
      failures.push("user");
    }
  }

  let finalInventory;
  try {
    finalInventory = assertNormalizedInventory(await inspectInventory({
      phase: "recovery-final",
      runNonce: journal.runNonce,
      userId: recoveryJournal.userId,
      coupleId: recoveryJournal.coupleId,
    }));
    if (![
      finalInventory.exactNonceAuthUserCount,
      finalInventory.exactNonceProfileCount,
      finalInventory.exactNonceCoupleCount,
      finalInventory.exactNonceStorageObjectCount,
    ].every((value) => value === 0)) failures.push("residue");
  } catch {
    failures.push("inventory");
  }
  if (failures.length > 0) {
    fail("STORAGE_PROBE_RECOVERY_FAILED", "Storage recovery did not prove exact zero residue");
  }

  const completedDate = now();
  if (!(completedDate instanceof Date) || !Number.isFinite(completedDate.valueOf())) {
    fail("PROBE_CLOCK_INVALID", "Storage recovery clock was invalid");
  }
  const result = Object.freeze({
    recoveryVersion: 1,
    kind: "amora-successor-storage-staging-recovery",
    status: "recovery_verified",
    projectRef: config.projectRef,
    gitCommit: config.expectedCommit,
    identityMarker: journal.identityMarker,
    completedAt: completedDate.toISOString(),
    productionVerified: false,
    productionMutations: 0,
    containsSecrets: false,
    containsObjectPaths: false,
    residue: Object.freeze({
      authUsers: finalInventory.exactNonceAuthUserCount,
      profiles: finalInventory.exactNonceProfileCount,
      couples: finalInventory.exactNonceCoupleCount,
      storageObjects: finalInventory.exactNonceStorageObjectCount,
    }),
  });
  await removeRecoveryJournal(config);
  return result;
}

export async function runAmoraSuccessorStorageStagingProbe({
  config,
  transport,
  inspectInventory,
  writeReceipt,
  runNonce = randomBytes(16).toString("hex"),
  now = () => new Date(),
  runtimePlatform = process.platform,
}) {
  if (!config || typeof transport !== "object" || typeof inspectInventory !== "function"
      || (writeReceipt !== undefined && typeof writeReceipt !== "function")
      || !RUN_NONCE.test(runNonce) || typeof now !== "function") {
    fail("PROBE_ARGUMENT_INVALID", "Storage staging probe dependencies were invalid");
  }
  assertAmoraSuccessorStorageHostedMutationPlatform(runtimePlatform);
  assertNewReceiptPathAvailable(config);
  const startedDate = now();
  if (!(startedDate instanceof Date) || !Number.isFinite(startedDate.valueOf())) {
    fail("PROBE_CLOCK_INVALID", "Storage staging probe clock was invalid");
  }
  const baseline = assertNormalizedInventory(await inspectInventory({
    phase: "baseline",
    runNonce,
    userId: null,
    coupleId: null,
  }));
  let recoveryJournal = await createRecoveryJournal(config, runNonce, startedDate);

  let user = null;
  let paths = null;
  let scenarioError = null;
  let cleanupError = null;
  let finalInventory = null;
  const checks = {
    baselineContract: true,
    signedExactPathUpload: false,
    signedDifferentPathDenied: false,
    anonUnsignedDenied: false,
    authenticatedUnsignedDenied: false,
    chatOwnInsertSucceeded: false,
    chatAnonInsertDenied: false,
    chatWrongCoupleDenied: false,
    chatWrongUploaderDenied: false,
    chatMalformedPathDenied: false,
    chatReadDenied: false,
    chatUpdateDenied: false,
    chatDeleteDenied: false,
    productionStorageOperationalState: baseline.productionStorageWritesAllowed === true,
    exactObjectCleanup: false,
    finalContractStable: false,
    exactNonceResidueZero: false,
  };

  try {
    user = await transport.createSyntheticUser(`amora-storage-${runNonce}`);
    if (!UUID.test(user?.id ?? "") || !UUID.test(user?.coupleId ?? "")
        || typeof user?.accessToken !== "string" || user.accessToken.length < 8) {
      fail("SYNTHETIC_USER_INVALID", "Synthetic Storage fixture was invalid");
    }
    paths = probePaths(user, runNonce);
    recoveryJournal = Object.freeze({
      ...recoveryJournal,
      userId: user.id,
      coupleId: user.coupleId,
      candidates: recoveryCandidates(paths),
    });
    await appendRecoveryJournal(config, recoveryJournal);
    const signedUpload = await transport.createSignedUpload({
      user,
      bucketId: paths.signed.bucketId,
      objectPath: paths.signed.objectPath,
    });
    if (signedUpload?.bucketId !== paths.signed.bucketId
        || signedUpload?.objectPath !== paths.signed.objectPath
        || typeof signedUpload?.token !== "string" || signedUpload.token.length < 3
        || typeof signedUpload?.signedUrl !== "string") {
      fail("SIGNED_UPLOAD_TOKEN_INVALID", "Signed upload response was not canonical");
    }
    const content = contentForBucket(paths.signed.bucketId);
    const uploaded = await transport.uploadSignedObject({
      signedUpload,
      bucketId: paths.signed.bucketId,
      objectPath: paths.signed.objectPath,
      contentType: content.contentType,
      bytes: content.bytes,
    });
    checks.signedExactPathUpload = uploaded?.uploaded === true;
    if (!checks.signedExactPathUpload) {
      fail("SIGNED_UPLOAD_FAILED", "Exact signed staging upload failed");
    }

    const differentPath = await transport.attemptSignedUploadAtDifferentPath({
      signedUpload,
      objectPath: paths.signed.objectPath,
      differentObjectPath: paths.differentSigned.objectPath,
    });
    checks.signedDifferentPathDenied = differentPath?.denied === true;
    if (!checks.signedDifferentPathDenied) {
      fail("SIGNED_UPLOAD_PATH_REUSE_ALLOWED", "Signed upload token accepted a different object path");
    }

    const actorChecks = { anon: [], authenticated: [] };
    for (const candidate of paths.unsigned) {
      const result = await transport.attemptUnsignedMutation({
        actor: candidate.actor,
        user,
        bucketId: candidate.bucketId,
        objectPath: candidate.objectPath,
      });
      actorChecks[candidate.actor].push(result?.denied === true);
      if (result?.denied !== true) {
        fail("UNSIGNED_STORAGE_MUTATION_ALLOWED", "An unsigned staging or final-bucket mutation was allowed");
      }
    }
    checks.anonUnsignedDenied = actorChecks.anon.length === UNSIGNED_BUCKETS.length
      && actorChecks.anon.every(Boolean);
    checks.authenticatedUnsignedDenied = actorChecks.authenticated.length === UNSIGNED_BUCKETS.length
      && actorChecks.authenticated.every(Boolean);

    const chatResult = await transport.verifyChatBoundary({
      user,
      bucketId: paths.chat.bucketId,
      ownObjectPath: paths.chat.own.objectPath,
      anonObjectPath: paths.chat.anon.objectPath,
      wrongCoupleObjectPath: paths.chat.wrongCouple.objectPath,
      wrongUploaderObjectPath: paths.chat.wrongUploader.objectPath,
      malformedObjectPath: paths.chat.malformed.objectPath,
    });
    for (const [checkName, resultName] of [
      ["chatOwnInsertSucceeded", "ownInsertSucceeded"],
      ["chatAnonInsertDenied", "anonInsertDenied"],
      ["chatWrongCoupleDenied", "wrongCoupleDenied"],
      ["chatWrongUploaderDenied", "wrongUploaderDenied"],
      ["chatMalformedPathDenied", "malformedPathDenied"],
      ["chatReadDenied", "readDenied"],
      ["chatUpdateDenied", "updateDenied"],
      ["chatDeleteDenied", "deleteDenied"],
    ]) {
      checks[checkName] = chatResult?.[resultName] === true;
    }
    if (!Object.entries(checks)
      .filter(([name]) => name.startsWith("chat"))
      .every(([, value]) => value === true)) {
      fail("CHAT_STORAGE_BOUNDARY_INVALID", "Canonical chat Storage boundary did not match the cumulative contract");
    }
  } catch (error) {
    scenarioError = error;
  } finally {
    const cleanupFailures = [];
    if (paths) {
      for (const candidate of recoveryCandidates(paths)) {
        try {
          const cleaned = await transport.deleteExactObject({
            bucketId: candidate.bucketId,
            objectPath: candidate.objectPath,
          });
          if (cleaned?.absent !== true) cleanupFailures.push("object");
        } catch {
          cleanupFailures.push("object");
        }
      }
      checks.exactObjectCleanup = cleanupFailures.length === 0;
    }
    if (user) {
      try {
        const deleted = await transport.deleteSyntheticUser(user.id);
        if (deleted?.deleted !== true) cleanupFailures.push("user");
      } catch {
        cleanupFailures.push("user");
      }
    }
    try {
      finalInventory = assertNormalizedInventory(await inspectInventory({
        phase: "final",
        runNonce,
        userId: user?.id ?? null,
        coupleId: user?.coupleId ?? null,
      }));
      checks.finalContractStable = stableSemantics(baseline, finalInventory);
      checks.exactNonceResidueZero = [
        finalInventory.exactNonceAuthUserCount,
        finalInventory.exactNonceProfileCount,
        finalInventory.exactNonceCoupleCount,
        finalInventory.exactNonceStorageObjectCount,
      ].every((value) => value === 0);
      if (!checks.finalContractStable) cleanupFailures.push("semantics");
      if (!checks.exactNonceResidueZero) cleanupFailures.push("residue");
    } catch (error) {
      cleanupFailures.push("inventory");
      cleanupError = error;
    }
    if (cleanupFailures.length > 0 && cleanupError === null) {
      cleanupError = new AmoraSuccessorStorageStagingProbeError(
        "STORAGE_PROBE_CLEANUP_FAILED",
        "Storage staging probe cleanup or final contract verification failed",
      );
    }
  }

  if (cleanupError) throw cleanupError;
  if (scenarioError) throw scenarioError;
  const completedDate = now();
  if (!(completedDate instanceof Date) || !Number.isFinite(completedDate.valueOf())) {
    fail("PROBE_CLOCK_INVALID", "Storage staging probe clock was invalid");
  }
  const receipt = Object.freeze({
    receiptVersion: 1,
    kind: "amora-successor-storage-staging-upload-cleanup",
    status: "upload_cleanup_verified",
    scope: "staging-storage-exact-upload-and-cleanup-only",
    projectRef: config.projectRef,
    gitCommit: config.expectedCommit,
    migrationLedger: Object.freeze({
      count: config.expectedMigrationCount,
      head: config.expectedMigrationHead,
    }),
    startedAt: startedDate.toISOString(),
    completedAt: completedDate.toISOString(),
    signedUploadTokenExpired: false,
    drainVerified: false,
    productionVerified: false,
    productionMutations: 0,
    tokenPersisted: false,
    containsSecrets: false,
    containsObjectPaths: false,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({
      authUsers: finalInventory.exactNonceAuthUserCount,
      profiles: finalInventory.exactNonceProfileCount,
      couples: finalInventory.exactNonceCoupleCount,
      storageObjects: finalInventory.exactNonceStorageObjectCount,
    }),
    inventory: Object.freeze({
      bucketContractSha256: baseline.bucketContractSha256,
      storagePolicyContractSha256: baseline.storagePolicyContractSha256,
      baselineObjectInventorySha256: baseline.objectInventorySha256,
      finalObjectInventorySha256: finalInventory.objectInventorySha256,
      globalObjectInventoryChanged:
        baseline.objectInventorySha256 !== finalInventory.objectInventorySha256,
    }),
  });
  if (writeReceipt) {
    await writeReceipt(receipt);
  } else {
    await persistReceipt(config, receipt);
  }
  await removeRecoveryJournal(config);
  return receipt;
}

export function storageProbeReceiptSha256(receipt) {
  return createHash("sha256")
    .update(`${JSON.stringify(receipt, null, 2)}\n`, "utf8")
    .digest("hex");
}
