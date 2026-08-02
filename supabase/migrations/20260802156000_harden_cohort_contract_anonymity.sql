-- Enforce cohort contract k-anonymity at the database boundary.
--
-- One member may contribute at most one value per room/category. Aggregate
-- prices are released only after five distinct active contributions exist.
-- Browser/mobile table writes are removed; the web API uses the service-only,
-- expected-actor-bound upsert below.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $cohort_contract_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I.%I', prerequisite.table_schema,
      prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_schema, prerequisite.table_name,
      prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('auth', 'users', 'id'),
    ('public', 'cohort_members', 'room_id'),
    ('public', 'cohort_members', 'user_id'),
    ('public', 'cohort_members', 'is_active'),
    ('public', 'cohort_contracts', 'id'),
    ('public', 'cohort_contracts', 'room_id'),
    ('public', 'cohort_contracts', 'user_id'),
    ('public', 'cohort_contracts', 'vendor_name'),
    ('public', 'cohort_contracts', 'category'),
    ('public', 'cohort_contracts', 'base_price'),
    ('public', 'cohort_contracts', 'extra_price'),
    ('public', 'cohort_contracts', 'notes'),
    ('public', 'cohort_contracts', 'created_at')
  ) AS prerequisite(table_schema, table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = prerequisite.table_schema
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;
END;
$cohort_contract_preflight$;

LOCK TABLE public.cohort_contracts IN SHARE ROW EXCLUSIVE MODE;

-- Historical duplicate rows may predate this invariant. Preserve the latest
-- submission for each actor/category and remove older rows before adding the
-- uniqueness constraint. Stats never weight one actor more than once.
WITH ranked_contracts AS MATERIALIZED (
  SELECT
    contract.id,
    pg_catalog.row_number() OVER (
      PARTITION BY contract.room_id, contract.user_id, contract.category
      ORDER BY contract.created_at DESC NULLS LAST, contract.id DESC
    ) AS contribution_rank
  FROM public.cohort_contracts AS contract
)
DELETE FROM public.cohort_contracts AS contract
USING ranked_contracts AS ranked
WHERE contract.id = ranked.id
  AND ranked.contribution_rank > 1;

ALTER TABLE public.cohort_contracts
  DROP CONSTRAINT IF EXISTS cohort_contracts_room_user_category_key;
DROP INDEX IF EXISTS public.cohort_contracts_room_user_category_key;
CREATE UNIQUE INDEX cohort_contracts_room_user_category_key
  ON public.cohort_contracts (room_id, user_id, category);
ALTER TABLE public.cohort_contracts
  ADD CONSTRAINT cohort_contracts_room_user_category_key
  UNIQUE USING INDEX cohort_contracts_room_user_category_key;

-- NOT VALID intentionally avoids rewriting or silently coercing historical
-- user data. PostgreSQL still applies each check to every new/updated row, and
-- the hardened stats view below excludes any legacy row outside the contract.
ALTER TABLE public.cohort_contracts
  DROP CONSTRAINT IF EXISTS cohort_contracts_vendor_name_sane,
  DROP CONSTRAINT IF EXISTS cohort_contracts_category_sane,
  DROP CONSTRAINT IF EXISTS cohort_contracts_base_price_sane,
  DROP CONSTRAINT IF EXISTS cohort_contracts_extra_price_sane,
  DROP CONSTRAINT IF EXISTS cohort_contracts_total_price_sane,
  DROP CONSTRAINT IF EXISTS cohort_contracts_notes_sane;

ALTER TABLE public.cohort_contracts
  ADD CONSTRAINT cohort_contracts_vendor_name_sane
    CHECK (
      pg_catalog.char_length(pg_catalog.btrim(vendor_name)) BETWEEN 1 AND 200
    ) NOT VALID,
  ADD CONSTRAINT cohort_contracts_category_sane
    CHECK (category IN (
      'venue', 'studio', 'dress', 'makeup',
      'snap', 'ring', 'honeymoon', 'other'
    )) NOT VALID,
  ADD CONSTRAINT cohort_contracts_base_price_sane
    CHECK (base_price IS NOT NULL AND base_price BETWEEN 0 AND 100000) NOT VALID,
  ADD CONSTRAINT cohort_contracts_extra_price_sane
    CHECK (extra_price IS NULL OR extra_price BETWEEN 0 AND 100000) NOT VALID,
  ADD CONSTRAINT cohort_contracts_total_price_sane
    CHECK (base_price + COALESCE(extra_price, 0) <= 100000) NOT VALID,
  ADD CONSTRAINT cohort_contracts_notes_sane
    CHECK (notes IS NULL OR pg_catalog.char_length(notes) <= 1000) NOT VALID;

-- Remove every policy that could authorize a write, including a legacy FOR ALL
-- policy. Table/column ACLs are also closed below, so direct PostgREST writes
-- stay denied even if a future policy is accidentally broadened.
DO $drop_cohort_contract_write_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cohort_contracts'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.cohort_contracts',
      policy_row.policyname
    );
  END LOOP;
END;
$drop_cohort_contract_write_policies$;

DROP POLICY IF EXISTS cohort_contracts_select_own
  ON public.cohort_contracts;
CREATE POLICY cohort_contracts_select_own
  ON public.cohort_contracts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL PRIVILEGES ON TABLE public.cohort_contracts
  FROM PUBLIC, anon, authenticated, service_role;
DO $revoke_cohort_contract_column_privileges$
DECLARE
  all_columns text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I', column_name),
    ', ' ORDER BY ordinal_position
  )
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'cohort_contracts';

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES (%s) ON TABLE public.cohort_contracts FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
END;
$revoke_cohort_contract_column_privileges$;
GRANT SELECT ON TABLE public.cohort_contracts TO authenticated, service_role;
GRANT SELECT ON TABLE public.cohort_members TO service_role;

CREATE OR REPLACE VIEW public.cohort_stats
WITH (security_invoker = true)
AS
SELECT
  contract.room_id,
  contract.category,
  pg_catalog.count(DISTINCT contract.user_id) AS sample_size,
  CASE
    WHEN pg_catalog.count(DISTINCT contract.user_id) >= 5
      THEN pg_catalog.round(pg_catalog.avg(contract.base_price))::integer
  END AS avg_base_price,
  CASE
    WHEN pg_catalog.count(DISTINCT contract.user_id) >= 5
      THEN pg_catalog.round(pg_catalog.avg(contract.extra_price))::integer
  END AS avg_extra_price,
  CASE
    WHEN pg_catalog.count(DISTINCT contract.user_id) >= 5
      THEN pg_catalog.round(
        pg_catalog.avg(contract.base_price + COALESCE(contract.extra_price, 0))
      )::integer
  END AS avg_total
FROM public.cohort_contracts AS contract
WHERE EXISTS (
    SELECT 1
    FROM public.cohort_members AS member
    WHERE member.room_id = contract.room_id
      AND member.user_id = contract.user_id
      AND member.is_active IS TRUE
  )
  AND pg_catalog.char_length(pg_catalog.btrim(contract.vendor_name)) BETWEEN 1 AND 200
  AND contract.category IN (
    'venue', 'studio', 'dress', 'makeup',
    'snap', 'ring', 'honeymoon', 'other'
  )
  AND contract.base_price BETWEEN 0 AND 100000
  AND (contract.extra_price IS NULL OR contract.extra_price BETWEEN 0 AND 100000)
  AND contract.base_price + COALESCE(contract.extra_price, 0) <= 100000
  AND (contract.notes IS NULL OR pg_catalog.char_length(contract.notes) <= 1000)
GROUP BY contract.room_id, contract.category;

ALTER VIEW public.cohort_stats OWNER TO postgres;
REVOKE ALL PRIVILEGES ON TABLE public.cohort_stats
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cohort_stats TO service_role;

CREATE OR REPLACE FUNCTION public.community_upsert_cohort_contract(
  p_expected_user_id uuid,
  p_user_id uuid,
  p_room_id uuid,
  p_vendor_name text,
  p_category text,
  p_base_price integer,
  p_extra_price integer DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_upsert_cohort_contract$
DECLARE
  clean_vendor_name text := pg_catalog.btrim(p_vendor_name);
  clean_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
  saved_contract public.cohort_contracts%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'cohort_contract_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_user_id IS NULL
     OR p_user_id IS NULL
     OR p_expected_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'cohort_contract_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = p_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_contract_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'cohort_contract_room_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.cohort_members AS member
  WHERE member.room_id = p_room_id
    AND member.user_id = p_user_id
    AND member.is_active IS TRUE
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_contract_membership_required'
      USING ERRCODE = '42501';
  END IF;

  IF clean_vendor_name IS NULL
     OR pg_catalog.char_length(clean_vendor_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'cohort_contract_vendor_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_category IS NULL OR p_category NOT IN (
    'venue', 'studio', 'dress', 'makeup',
    'snap', 'ring', 'honeymoon', 'other'
  ) THEN
    RAISE EXCEPTION 'cohort_contract_category_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_base_price IS NULL
     OR p_base_price < 0
     OR p_base_price > 100000
     OR p_extra_price < 0
     OR p_extra_price > 100000
     OR p_base_price + COALESCE(p_extra_price, 0) > 100000 THEN
    RAISE EXCEPTION 'cohort_contract_price_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF clean_notes IS NOT NULL
     AND pg_catalog.char_length(clean_notes) > 1000 THEN
    RAISE EXCEPTION 'cohort_contract_notes_invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cohort_contracts AS contract (
    room_id,
    user_id,
    vendor_name,
    category,
    base_price,
    extra_price,
    notes
  ) VALUES (
    p_room_id,
    p_user_id,
    clean_vendor_name,
    p_category,
    p_base_price,
    p_extra_price,
    clean_notes
  )
  ON CONFLICT ON CONSTRAINT cohort_contracts_room_user_category_key
  DO UPDATE SET
    vendor_name = EXCLUDED.vendor_name,
    base_price = EXCLUDED.base_price,
    extra_price = EXCLUDED.extra_price,
    notes = EXCLUDED.notes
  RETURNING contract.* INTO saved_contract;

  RETURN pg_catalog.jsonb_build_object(
    'id', saved_contract.id,
    'room_id', saved_contract.room_id,
    'user_id', saved_contract.user_id,
    'vendor_name', saved_contract.vendor_name,
    'category', saved_contract.category,
    'base_price', saved_contract.base_price,
    'extra_price', saved_contract.extra_price,
    'notes', saved_contract.notes,
    'created_at', saved_contract.created_at
  );
END;
$community_upsert_cohort_contract$;

ALTER FUNCTION public.community_upsert_cohort_contract(
  uuid, uuid, uuid, text, text, integer, integer, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_upsert_cohort_contract(
  uuid, uuid, uuid, text, text, integer, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_upsert_cohort_contract(
  uuid, uuid, uuid, text, text, integer, integer, text
) TO service_role;

COMMENT ON FUNCTION public.community_upsert_cohort_contract(
  uuid, uuid, uuid, text, text, integer, integer, text
) IS
  'Service-only expected-actor-bound upsert. Requires active room membership and one bounded contribution per actor/category.';
COMMENT ON VIEW public.cohort_stats IS
  'Service-only cohort price aggregates. Values remain NULL until five distinct bounded contributors exist.';

DO $cohort_contract_postcondition$
DECLARE
  duplicate_key record;
  write_policy text;
  function_owner name;
  function_security_definer boolean;
  function_config text[];
BEGIN
  SELECT room_id, user_id, category
  INTO duplicate_key
  FROM public.cohort_contracts
  GROUP BY room_id, user_id, category
  HAVING pg_catalog.count(*) > 1
  LIMIT 1;
  IF duplicate_key IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_DUPLICATE_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cohort_contracts'::pg_catalog.regclass
      AND conname = 'cohort_contracts_room_user_category_key'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_UNIQUENESS_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT policyname
  INTO write_policy
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'cohort_contracts'
    AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LIMIT 1;
  IF write_policy IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_WRITE_POLICY_REMAINS: %', write_policy
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.cohort_contracts', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.cohort_contracts', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.cohort_contracts', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.cohort_contracts', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.cohort_contracts', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.cohort_contracts', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.cohort_contracts', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.cohort_contracts', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.cohort_contracts', 'DELETE')
     OR pg_catalog.has_any_column_privilege('anon', 'public.cohort_contracts', 'INSERT')
     OR pg_catalog.has_any_column_privilege('anon', 'public.cohort_contracts', 'UPDATE')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.cohort_contracts', 'INSERT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.cohort_contracts', 'UPDATE')
     OR pg_catalog.has_any_column_privilege('service_role', 'public.cohort_contracts', 'INSERT')
     OR pg_catalog.has_any_column_privilege('service_role', 'public.cohort_contracts', 'UPDATE') THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_DIRECT_WRITE_PRIVILEGE_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  SELECT owner.rolname, proc.prosecdef, proc.proconfig
  INTO function_owner, function_security_definer, function_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = proc.proowner
  WHERE proc.oid = pg_catalog.to_regprocedure(
    'public.community_upsert_cohort_contract(uuid,uuid,uuid,text,text,integer,integer,text)'
  );

  IF function_owner IS DISTINCT FROM 'postgres'
     OR function_security_definer IS DISTINCT FROM TRUE
     OR NOT COALESCE(function_config, ARRAY[]::text[])
       @> ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_RPC_SECURITY_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.community_upsert_cohort_contract(uuid,uuid,uuid,text,text,integer,integer,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.community_upsert_cohort_contract(uuid,uuid,uuid,text,text,integer,integer,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.community_upsert_cohort_contract(uuid,uuid,uuid,text,text,integer,integer,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COHORT_CONTRACT_RPC_EXECUTE_ACL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'cohort_stats'
      AND relation.relkind = 'v'
      AND COALESCE(relation.reloptions, ARRAY[]::text[])
        @> ARRAY['security_invoker=true']::text[]
  ) THEN
    RAISE EXCEPTION 'COHORT_STATS_SECURITY_INVOKER_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'service_role', 'public.cohort_members', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.cohort_stats', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.cohort_stats', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.cohort_stats', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'COHORT_STATS_READ_ACL_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$cohort_contract_postcondition$;

COMMIT;
